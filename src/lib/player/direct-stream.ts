import { getClientIdentity } from "@/api/client/client-identity"
import { buildSeaQuery } from "@/api/client/requests"
import { sendWsMessage, subscribeWsMessage } from "@/api/components/websocket-hub"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { MKVParser_Metadata, NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { logger } from "@/lib/utils/logger"
import type { MpvChapter, MpvMediaEvent, MpvStreamedSubtitleLine, MpvStreamedSubtitles } from "expo-mpv-player"
import { Platform } from "react-native"
import { eventsOf, toLines } from "./direct-stream-format"
import { probeStreamUrl } from "./kept-direct-stream"
import type { MobilePlaybackSource } from "./types"

export { describeStreamCodecs, type StreamCodecs } from "./direct-stream-format"

/**
 * Seanime's direct stream (the "nativeplayer" playback type), which the web
 * (LG webOS) build uses for torrent and debrid streams.
 *
 * The server serves the file at /api/v1/directstream/stream with a type the
 * TV accepts and reads the subtitle lines from it as it goes: they arrive
 * over the websocket once the player reports its metadata, and again from
 * the new position after a seek. Native builds play the external player
 * link with mpv, which reads embedded subtitles itself.
 */

const log = logger("direct-stream")

export const NATIVE_PLAYER_EVENT = "native-player"
/** Sent instead of NATIVE_PLAYER_EVENT when the server plays streams with MpvPrism. */
export const MPVCORE_EVENT = "mpvcore"
const VIDEOCORE_EVENT = "videocore"

/** The playback type to ask the server for when starting a torrent or debrid stream. */
export function streamPlaybackType(): "nativeplayer" | "externalPlayerLink" {
    return Platform.OS === "web" ? "nativeplayer" : "externalPlayerLink"
}

export type NativePlayerServerEvent =
    | { type: "open-and-await"; payload: string }
    | { type: "abort-open"; payload: string }
    | { type: "watch"; payload: NativePlayer_PlaybackInfo }
    | { type: "subtitle-event"; payload: unknown }
    | { type: "error"; payload: { error?: string } }
    | { type: "set-tracks"; payload: unknown }

export function parseNativePlayerEvent(payload: unknown): NativePlayerServerEvent | null {
    if (typeof payload !== "object" || payload === null) return null
    const event = payload as { type?: unknown; payload?: unknown }
    return typeof event.type === "string" ? event as NativePlayerServerEvent : null
}

/** Chapters from the file, for the player's chapter marks. */
export function directStreamChapters(metadata: MKVParser_Metadata | undefined): MpvChapter[] {
    return (metadata?.chapters ?? [])
        .filter(chapter => Number.isFinite(chapter.start))
        .map((chapter, index) => ({ id: index, time: chapter.start, title: chapter.text || undefined }))
}

const MEDIA_EVENTS: Record<MpvMediaEvent["type"], string> = {
    loadedmetadata: "video-loaded-metadata",
    seeked: "video-seeked",
    pause: "video-paused",
    play: "video-resumed",
    ended: "video-ended",
    status: "video-status",
}

/**
 * Tells the server a direct stream's player is gone (or never opened), which
 * ends the stream. Only for a stream the server still plays for this app:
 * it also clears the server's player state for this client, which by then
 * may belong to a newer stream.
 */
export function terminateDirectStream(playbackId: string, playbackType: string): boolean {
    const { clientId } = getClientIdentity()
    return sendWsMessage({
        type: VIDEOCORE_EVENT,
        payload: { clientId, type: "video-terminated", payload: { id: playbackId, clientId, playerType: "native", playbackType } },
    })
}

/**
 * With no websocket to say "video-terminated" on (a TV waking from standby
 * before it reconnects), the stream is stopped over HTTP instead, or the
 * server would keep downloading the torrent until another stream starts.
 * That request stops whatever the server streams, so it only goes out while
 * the server still serves this playback: a TV that slept through another
 * device starting a stream would stop that one.
 */
async function stopStreamOverHttp(source: MobilePlaybackSource, playbackType: string) {
    const apiIndex = source.url.indexOf("/api/v1/")
    if (apiIndex < 0) return
    if (await probeStreamUrl(source.url) !== "alive") {
        log.info("Not stopping over HTTP: the server no longer serves this stream", { playbackType })
        return
    }
    const debrid = playbackType === "debrid"
    const endpoint = debrid ? API_ENDPOINTS.DEBRID.DebridCancelStream : API_ENDPOINTS.TORRENTSTREAM.TorrentstreamStopStream
    log.info("No websocket; stopping the stream over HTTP", { playbackType })
    void buildSeaQuery({
        serverUrl: source.url.slice(0, apiIndex),
        endpoint: endpoint.endpoint,
        method: endpoint.methods[0],
        data: debrid ? {} : undefined,
        muteError: true,
    }).catch(error => log.warning("Could not stop the stream over HTTP", error))
}

export type DirectStreamSession = {
    playbackId: string
    streamedSubtitles: MpvStreamedSubtitles
    onMediaEvent: (event: MpvMediaEvent) => void
    /** Seconds into the episode at the player's last event. */
    position: () => number
    /** The player reached the end of the episode. */
    ended: () => boolean
    /**
     * A player shows the stream again after one left it (webOS keeps it
     * running, see kept-direct-stream.ts): tells the server, and has it read
     * the subtitles again from where the new player starts.
     */
    reattach: () => void
    /**
     * The player closed but the stream keeps running (webOS): gives up the
     * server's player slot. The server follows one player and ignores every
     * other device while that one stays connected, so a phone or another TV
     * would get no subtitles and no progress while this TV shows a menu.
     */
    release: () => void
    /** Tells the server the player is gone, which ends the stream. */
    terminate: () => void
    /** Stops following the stream without telling the server, which already ended it. */
    forget: () => void
}

/**
 * Follows one direct-stream playback: reports the player's events to the
 * server (it starts reading subtitles on "video-loaded-metadata") and
 * collects the subtitle lines it sends back. The lines it collects stay
 * with the session while no player shows it: the server sends each line
 * once and never again unless the player seeks.
 */
export function createDirectStreamSession(source: MobilePlaybackSource): DirectStreamSession | null {
    const playbackId = source.directStreamPlaybackId
    if (!playbackId) return null

    const { clientId } = getClientIdentity()
    const playbackType = source.serverStreamType ?? "torrent"
    const tracks = (source.mkvMetadata?.subtitleTracks ?? []).map(track => ({
        number: track.number,
        title: track.name || undefined,
        lang: track.language || undefined,
        codec: track.codecID,
        // CodecPrivate is the script header; Matroska muxers often end it with a NUL.
        header: track.codecPrivate?.replace(/\u0000+$/, "") || undefined,
    }))

    const lines: MpvStreamedSubtitleLine[] = []
    const listeners = new Set<(lines: MpvStreamedSubtitleLine[]) => void>()
    let loaded = false
    let terminated = false
    let position = 0
    let ended = false
    /** Set when a player picks the stream up again, until its metadata arrives. */
    let resyncSubtitles = false

    const send = (type: string, payload: unknown) => {
        if (!sendWsMessage({ type: VIDEOCORE_EVENT, payload: { clientId, type, payload } })) {
            log.warning("No websocket to report the player event to", type)
        }
    }

    const unsubscribe = subscribeWsMessage((message) => {
        if (message.type !== NATIVE_PLAYER_EVENT) return
        const event = parseNativePlayerEvent(message.payload)
        if (event?.type !== "subtitle-event") return
        const received = toLines(eventsOf(event.payload, playbackId))
        if (received.length === 0) return
        lines.push(...received)
        for (const listener of listeners) listener(received)
    })

    // Sent once per player that shows the stream: the server keeps the
    // stream for the client that loaded it.
    const reportLoaded = () => {
        if (loaded) return
        loaded = true
        send("video-loaded", {
            state: {
                clientId,
                playerType: "native",
                playbackInfo: {
                    id: playbackId,
                    playbackType,
                    streamUrl: source.url,
                    mkvMetadata: source.mkvMetadata,
                    media: source.media,
                    episode: source.episode,
                    streamType: "native",
                },
            },
        })
    }

    // Right away, not with the first media event: the server handles each client
    // event on its own goroutine, and metadata reported before "video-loaded"
    // would be dropped (and with it the subtitle stream).
    reportLoaded()

    const stop = () => {
        terminated = true
        unsubscribe()
        listeners.clear()
    }

    return {
        playbackId,
        streamedSubtitles: {
            tracks,
            subscribe: (listener) => {
                if (lines.length > 0) listener(lines.slice())
                listeners.add(listener)
                return () => listeners.delete(listener)
            },
        },
        onMediaEvent: (event) => {
            if (terminated) return
            if (Number.isFinite(event.currentTime)) position = event.currentTime
            if (event.type === "ended") ended = true
            else if (event.type === "play" || event.type === "seeked") ended = false
            const payload = { currentTime: event.currentTime, duration: event.duration, paused: event.paused }
            send(MEDIA_EVENTS[event.type], event.type === "ended" ? { autoNext: false } : payload)
            if (event.type === "loadedmetadata" && resyncSubtitles) {
                resyncSubtitles = false
                // The server ignores a second "video-loaded-metadata" once the
                // player has seeked, and never sends a line twice otherwise. A
                // seek report makes it read the subtitles again from here, in
                // case lines went missing while no player showed the stream.
                send(MEDIA_EVENTS.seeked, payload)
            }
        },
        position: () => position,
        ended: () => ended,
        reattach: () => {
            if (terminated) return
            loaded = false
            resyncSubtitles = true
            reportLoaded()
        },
        release: () => {
            if (terminated || !loaded) return
            loaded = false
            // "video-terminated" for a playback that isn't this one: VideoCore
            // frees its player slot whatever the ID, while the direct stream and
            // mediacore drop a termination of another playback (Seanime 3.10.4),
            // so the stream keeps running.
            send("video-terminated", { id: `${playbackId}:left`, clientId, playerType: "native", playbackType })
        },
        terminate: () => {
            if (terminated) return
            stop()
            if (!terminateDirectStream(playbackId, playbackType)) void stopStreamOverHttp(source, playbackType)
        },
        forget: () => {
            if (terminated) return
            stop()
        },
    }
}
