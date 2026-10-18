/**
 * What a Seanime direct stream sends, in the shapes the web player takes.
 * Kept free of React Native so the tests can load it.
 */
import type { MKVParser_Metadata, MKVParser_SubtitleEvent, NativePlayer_SubtitleEventsPayload } from "@/api/generated/types"
import type { MpvStreamedSubtitleLine } from "expo-mpv-player"

export function toLines(events: MKVParser_SubtitleEvent[]): MpvStreamedSubtitleLine[] {
    return events.map(event => ({
        trackNumber: event.trackNumber,
        // The server sends milliseconds.
        start: event.startTime / 1000,
        end: (event.startTime + event.duration) / 1000,
        text: event.text,
        style: event.extraData?.style,
    }))
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
