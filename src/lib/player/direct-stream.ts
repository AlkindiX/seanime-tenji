import { getClientIdentity } from "@/api/client/client-identity"
import { sendWsMessage, subscribeWsMessage } from "@/api/components/websocket-hub"
import type { MKVParser_Metadata, NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { logger } from "@/lib/utils/logger"
import type { MpvChapter, MpvMediaEvent, MpvStreamedSubtitleLine, MpvStreamedSubtitles } from "expo-mpv-player"
import { Platform } from "react-native"
import { eventsOf, toLines } from "./direct-stream-format"
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

export type DirectStreamSession = {
    streamedSubtitles: MpvStreamedSubtitles
    onMediaEvent: (event: MpvMediaEvent) => void
    /** Tells the server the player is gone, which ends the stream. */
    terminate: () => void
}

/**
 * Follows one direct-stream playback: reports the player's events to the
 * server (it starts reading subtitles on "video-loaded-metadata") and
 * collects the subtitle lines it sends back.
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
        header: track.codecPrivate || undefined,
    }))

    const lines: MpvStreamedSubtitleLine[] = []
    const listeners = new Set<(lines: MpvStreamedSubtitleLine[]) => void>()
    let loaded = false
    let terminated = false

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

    // Sent once: the server keeps the stream for the client that loaded it.
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

    return {
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
            reportLoaded()
            const payload = { currentTime: event.currentTime, duration: event.duration, paused: event.paused }
            send(MEDIA_EVENTS[event.type], event.type === "ended" ? { autoNext: false } : payload)
        },
        terminate: () => {
            if (terminated) return
            terminated = true
            unsubscribe()
            listeners.clear()
            send("video-terminated", { id: playbackId, clientId, playerType: "native", playbackType })
        },
    }
}
