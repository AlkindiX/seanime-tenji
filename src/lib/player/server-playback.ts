/**
 * Torrent and debrid streams on webOS, played through the Seanime server's
 * player pipeline (`playbackType: "nativeplayer"`).
 *
 * Browsers can't read the subtitle tracks inside an MKV. In this mode the
 * server parses the stream it serves and sends the subtitle lines over the
 * WebSocket (`native-player` / `subtitle-event`), as it does for Seanime's own
 * web player. It starts reading them once the player reports the video's
 * metadata, and again from the new position after a seek, so this module
 * reports those VideoCore client events back.
 *
 * Text lines become cues (the player's plain-text overlay), ASS packets are
 * also kept for libass (styling, signs, positioning), and PGS events, which
 * the server decodes to PNG images, become image cues.
 */
import { getClientIdentity } from "@/api/client/client-identity"
import { sendWsMessage } from "@/api/components/websocket-hub"
import type { MKVParser_SubtitleEvent, MKVParser_TrackInfo, NativePlayer_PlaybackInfo, NativePlayer_SubtitleEventsPayload } from "@/api/generated/types"
import { logger } from "@/lib/utils/logger"
import {
    assDialogueCue,
    parseAssTopStyles,
    registerSubtitleFeed,
    type AssTopStyles,
    type SubtitleFeedCue,
    type SubtitleFeedPlayerEvent,
    type SubtitleFeedTrack,
} from "expo-mpv-player"
import { Platform } from "react-native"

const log = logger("server-playback")

/** Start streams through the server's player pipeline on webOS, for its subtitles. */
export const STREAM_PLAYBACK_TYPE = Platform.OS === "web" ? "nativeplayer" : "externalPlayerLink"

/** Codecs the web player can show: text, ASS (libass, or as text) and PGS images. */
const SUBTITLE_CODECS = new Set(["S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/UTF8", "S_HDMV/PGS"])
const ASS_CODECS = new Set(["S_TEXT/ASS", "S_TEXT/SSA"])
/** How long an image subtitle stays up when the server sends no duration. */
const IMAGE_FALLBACK_DURATION_MS = 5000

type FeedTrack = SubtitleFeedTrack & { topStyles: AssTopStyles; seen: Set<string>; readOrder: number }

type ServerPlayback = {
    info: NativePlayer_PlaybackInfo
    tracks: Map<number, FeedTrack>
    listeners: Set<() => void>
    generation: number
    unregister: () => void
}

let current: ServerPlayback | null = null

function sendVideoCoreEvent(type: string, payload: Record<string, unknown>) {
    const clientId = getClientIdentity().clientId
    const sent = sendWsMessage({ type: "videocore", payload: { clientId, type, payload } })
    if (!sent) log.warning("WebSocket closed; could not tell the server", type)
}

function trackTitle(track: MKVParser_TrackInfo) {
    return track.name || track.languageIETF || track.language || `Track ${track.number}`
}

function onPlayerEvent(playback: ServerPlayback, event: SubtitleFeedPlayerEvent) {
    if (current !== playback) return
    const clientId = getClientIdentity().clientId
    const status = {
        id: playback.info.id,
        clientId,
        currentTime: event.position,
        duration: Number.isFinite(event.duration) ? event.duration : 0,
        paused: event.paused,
    }
    if (event.type === "loadedmetadata") {
        sendVideoCoreEvent("video-loaded-metadata", status)
        // The server reads subtitles from the start; a resumed episode starts later.
        if (event.position > 5) sendVideoCoreEvent("video-seeked", status)
        return
    }
    sendVideoCoreEvent("video-seeked", status)
}

/**
 * Called with the server's `watch` event. Returns the id of the subtitle feed
 * to pass to the player.
 */
export function beginServerPlayback(info: NativePlayer_PlaybackInfo): string {
    endServerPlayback()

    const tracks = new Map<number, FeedTrack>()
    for (const track of info.mkvMetadata?.subtitleTracks ?? []) {
        if (!SUBTITLE_CODECS.has(track.codecID)) continue
        // CodecPrivate is the script header; Matroska muxers often end it with a NUL.
        const header = (track.codecPrivate ?? "").replace(/\0+$/, "")
        tracks.set(track.number, {
            title: trackTitle(track),
            lang: track.language,
            codec: track.codecID,
            cues: [],
            ass: ASS_CODECS.has(track.codecID) ? { header, chunks: [] } : undefined,
            topStyles: parseAssTopStyles(header),
            seen: new Set(),
            readOrder: 0,
        })
    }

    const listeners = new Set<() => void>()
    const playback: ServerPlayback = { info, tracks, listeners, generation: -1, unregister: () => {} }
    playback.unregister = registerSubtitleFeed(info.id, {
        tracks: [...tracks.values()],
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        onPlayerEvent: event => onPlayerEvent(playback, event),
    })
    current = playback

    log.info("Server playback started", { id: info.id, streamType: info.streamType, subtitleTracks: tracks.size })
    const clientId = getClientIdentity().clientId
    sendVideoCoreEvent("video-loaded", {
        state: {
            clientId,
            playerType: "native",
            playbackInfo: {
                id: info.id,
                playbackType: info.streamType,
                streamUrl: info.streamUrl,
                streamPath: info.streamPath,
                mkvMetadata: info.mkvMetadata,
                media: info.media,
                episode: info.episode,
                localFile: info.localFile,
                streamType: "native",
            },
        },
    })
    return info.id
}

/** Inserts a cue keeping the start-time order the player relies on. */
function insertCue(cues: SubtitleFeedCue[], cue: SubtitleFeedCue) {
    let low = 0
    let high = cues.length
    while (low < high) {
        const middle = (low + high) >> 1
        if (cues[middle].start <= cue.start) low = middle + 1
        else high = middle
    }
    cues.splice(low, 0, cue)
}

/**
 * The packet as Matroska stores it, which libass reads: the dialogue fields
 * without Start and End. libass drops a packet whose ReadOrder it has seen,
 * and the server doesn't pass the file's on, so they are numbered here
 * (lines sent again after a seek are left out before this).
 */
function assChunk(event: MKVParser_SubtitleEvent, readOrder: number) {
    const fields = event.extraData ?? {}
    return [
        String(readOrder),
        // SSA has Marked where ASS has Layer.
        fields.layer ?? "0",
        fields.style ?? "Default",
        fields.name ?? "",
        fields.marginl ?? "0",
        fields.marginr ?? "0",
        fields.marginv ?? "0",
        fields.effect ?? "",
        event.text,
    ].join(",")
}

/** A PGS event: the server decoded it to a base64 PNG with its place on the video. */
function imageCue(event: MKVParser_SubtitleEvent): SubtitleFeedCue | null {
    const fields = event.extraData ?? {}
    const number = (key: string) => Number(fields[key])
    const width = number("width")
    const height = number("height")
    if (!(width > 0 && height > 0) || !event.text) return null

    const canvasWidth = number("canvas_width") || 0
    const canvasHeight = number("canvas_height") || 0
    const start = event.startTime / 1000
    const duration = event.duration > 0 ? event.duration : IMAGE_FALLBACK_DURATION_MS
    return {
        start,
        end: start + duration / 1000,
        text: "",
        image: {
            src: event.text.startsWith("data:") ? event.text : `data:image/png;base64,${event.text}`,
            // Without a position, centred near the bottom, where PGS subtitles sit.
            x: fields.x !== undefined ? number("x") : ((canvasWidth || 1920) - width) / 2,
            y: fields.y !== undefined ? number("y") : (canvasHeight || 1080) * 0.95 - height,
            width,
            height,
            canvasWidth,
            canvasHeight,
            crop: fields.crop_width !== undefined
                ? { x: number("crop_x"), y: number("crop_y"), width: number("crop_width"), height: number("crop_height") }
                : undefined,
        },
    }
}

function addEvents(playback: ServerPlayback, events: MKVParser_SubtitleEvent[]) {
    let added = false
    for (const event of events) {
        const track = playback.tracks.get(event.trackNumber)
        if (!track) continue
        const isImage = event.extraData?.type === "image"
        // Times are in milliseconds. A seek sends the lines around it again.
        const key = isImage ? `${event.startTime}:${event.text.length}:${event.text.slice(-32)}` : `${event.startTime}:${event.text}`
        if (track.seen.has(key)) continue
        track.seen.add(key)

        if (isImage) {
            const cue = imageCue(event)
            if (cue) insertCue(track.cues, cue)
            added ||= !!cue
            continue
        }

        if (track.ass) {
            track.ass.chunks.push({ data: assChunk(event, track.readOrder++), start: event.startTime, duration: event.duration })
            added = true
        }
        const start = event.startTime / 1000
        const cue = assDialogueCue(event.text, event.extraData?.style ?? "", start, start + event.duration / 1000, track.topStyles)
        if (!cue) continue
        insertCue(track.cues, cue)
        added = true
    }
    if (added) playback.listeners.forEach(listener => listener())
}

/** A `subtitle-event` payload: a batch with its playback and seek generation, or older bare events. */
export function receiveServerSubtitles(payload: unknown) {
    const playback = current
    if (!playback || !payload) return

    if (typeof payload === "object" && !Array.isArray(payload) && "events" in payload) {
        const batch = payload as NativePlayer_SubtitleEventsPayload
        if (batch.playbackId && batch.playbackId !== playback.info.id) return
        // Batches of an earlier seek still in flight are dropped.
        if (batch.generationId < playback.generation) return
        playback.generation = batch.generationId
        addEvents(playback, batch.events ?? [])
        return
    }

    addEvents(playback, Array.isArray(payload) ? payload as MKVParser_SubtitleEvent[] : [payload as MKVParser_SubtitleEvent])
}

/** Tells the server the player is gone, which ends its stream. */
export function endServerPlayback(id?: string) {
    const playback = current
    if (!playback || (id && playback.info.id !== id)) return
    current = null
    playback.unregister()
    log.info("Server playback ended", { id: playback.info.id })
    sendVideoCoreEvent("video-terminated", {
        id: playback.info.id,
        clientId: getClientIdentity().clientId,
        playerType: "native",
        playbackType: playback.info.streamType,
    })
}
