/**
 * What a Seanime direct stream sends, in the shapes the web player takes.
 * Kept free of React Native so the tests can load it.
 */
import type { MKVParser_Metadata, MKVParser_SubtitleEvent, NativePlayer_SubtitleEventsPayload } from "@/api/generated/types"
import type { MpvStreamedSubtitleLine, MpvSubtitleImage } from "expo-mpv-player"

/** How long an image subtitle stays up when the server sends no duration. */
const IMAGE_FALLBACK_DURATION_MS = 5000

export function toLines(events: MKVParser_SubtitleEvent[]): MpvStreamedSubtitleLine[] {
    const lines: MpvStreamedSubtitleLine[] = []
    for (const event of events) {
        const fields = event.extraData ?? {}
        // The server sends milliseconds.
        const start = event.startTime / 1000
        if (fields.type === "image") {
            const image = imageOf(event)
            if (!image) continue
            const duration = event.duration > 0 ? event.duration : IMAGE_FALLBACK_DURATION_MS
            lines.push({ trackNumber: event.trackNumber, start, end: start + duration / 1000, text: "", image })
            continue
        }
        lines.push({
            trackNumber: event.trackNumber,
            start,
            end: (event.startTime + event.duration) / 1000,
            text: event.text,
            style: fields.style,
            ass: {
                layer: fields.layer,
                name: fields.name,
                marginL: fields.marginl,
                marginR: fields.marginr,
                marginV: fields.marginv,
                effect: fields.effect,
            },
        })
    }
    return lines
}

/** A PGS event: the server decoded it to a base64 PNG with its place on the video. */
function imageOf(event: MKVParser_SubtitleEvent): MpvSubtitleImage | null {
    const fields = event.extraData ?? {}
    const number = (key: string) => Number(fields[key])
    const width = number("width")
    const height = number("height")
    if (!(width > 0 && height > 0) || !event.text) return null

    const canvasWidth = number("canvas_width") || 0
    const canvasHeight = number("canvas_height") || 0
    return {
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
    }
}

/** Subtitle events come as one event, a list, or (since seeking resets them) a batch with its playback id. */
export function eventsOf(payload: unknown, playbackId: string): MKVParser_SubtitleEvent[] {
    if (Array.isArray(payload)) return payload as MKVParser_SubtitleEvent[]
    if (typeof payload !== "object" || payload === null) return []
    if ("events" in payload) {
        const batch = payload as NativePlayer_SubtitleEventsPayload
        if (batch.playbackId && batch.playbackId !== playbackId) return []
        return batch.events ?? []
    }
    return [payload as MKVParser_SubtitleEvent]
}

const VIDEO_CODECS: Array<[RegExp, string]> = [
    [/^V_MPEG4\/ISO\/AVC/, "H.264"],
    [/^V_MPEGH\/ISO\/HEVC/, "HEVC"],
    [/^V_AV1/, "AV1"],
    [/^V_VP9/, "VP9"],
    [/^V_VP8/, "VP8"],
    [/^V_MPEG2/, "MPEG-2"],
]

const AUDIO_CODECS: Array<[RegExp, string]> = [
    [/^A_AAC/, "AAC"],
    [/^A_EAC3/, "E-AC-3"],
    [/^A_AC3/, "AC-3"],
    [/^A_DTS/, "DTS"],
    [/^A_TRUEHD/, "TrueHD"],
    [/^A_FLAC/, "FLAC"],
    [/^A_OPUS/, "Opus"],
    [/^A_VORBIS/, "Vorbis"],
    [/^A_MPEG\/L3/, "MP3"],
    [/^A_PCM/, "PCM"],
]

/**
 * Audio LG TVs don't play inside a video file, or only on some models; the
 * TV's player then tends to load forever. LG lists FLAC only as a music
 * format, and DTS for "specific models only".
 */
const RISKY_AUDIO = new Set(["FLAC", "Vorbis", "TrueHD", "DTS"])

function codecName(codecId: string, table: Array<[RegExp, string]>) {
    return table.find(([pattern]) => pattern.test(codecId))?.[1] ?? codecId.replace(/^[AV]_/, "")
}

export type StreamCodecs = {
    video?: string
    resolution?: string
    audio: string[]
    /** Audio in the file this TV may not play. */
    riskyAudio: string[]
}

export function describeStreamCodecs(metadata: MKVParser_Metadata | undefined): StreamCodecs {
    const video = metadata?.videoTracks?.[0]
    const audio = Array.from(new Set((metadata?.audioTracks ?? []).map(track => codecName(track.codecID, AUDIO_CODECS))))
    const size = video?.video
    return {
        video: video ? codecName(video.codecID, VIDEO_CODECS) : undefined,
        resolution: size?.PixelWidth && size.PixelHeight ? `${size.PixelWidth}×${size.PixelHeight}` : undefined,
        audio,
        riskyAudio: audio.filter(name => RISKY_AUDIO.has(name)),
    }
}
