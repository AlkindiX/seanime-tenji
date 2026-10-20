/**
 * What a Seanime direct stream sends, in the shapes the web player takes.
 * Kept free of React Native so the tests can load it.
 */
import type { MKVParser_Metadata, MKVParser_SubtitleEvent, MKVParser_TrackInfo, NativePlayer_SubtitleEventsPayload } from "@/api/generated/types"
import type { MpvStreamedSubtitleLine, MpvSubtitleImage } from "expo-mpv-player"
import { h264ProfileProblem } from "../webos/playback-capabilities.ts"
import { describeTVAudioTrack, mkvAudioCodec, type TVAudioTrack } from "../webos/tv-audio.ts"

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

function videoCodecName(codecId: string) {
    return VIDEO_CODECS.find(([pattern]) => pattern.test(codecId))?.[1] ?? codecId.replace(/^V_/, "")
}

/**
 * What the TV's decoder can't take about a video track, read from its
 * CodecPrivate (the decoder configuration record). The server sends it as a
 * string; its first bytes are below 0x80 and come through as they are.
 */
export function videoTrackProblem(track: Pick<MKVParser_TrackInfo, "codecID" | "codecPrivate"> | undefined): string | null {
    const config = track?.codecPrivate
    // configurationVersion is 1 in both AVC and HEVC records.
    if (!track || !config || config.length < 2 || config.charCodeAt(0) !== 1) return null
    const second = config.charCodeAt(1)
    if (second > 0x7f) return null
    if (/^V_MPEG4\/ISO\/AVC/.test(track.codecID)) return h264ProfileProblem(second)
    // general_profile_idc 4: range extensions (4:2:2, 4:4:4, 12-bit), beyond Main and Main10.
    if (/^V_MPEGH\/ISO\/HEVC/.test(track.codecID) && (second & 0x1f) === 4) return "HEVC 4:2:2/4:4:4 or 12-bit"
    return null
}

export type StreamCodecs = {
    /** "HEVC", or what the TV can't decode about it ("10-bit H.264 (Hi10P)"). */
    video?: string
    resolution?: string
    /** Each kind of audio track once: "FLAC 5.1", "AAC 2.0". */
    audio: string[]
    /** Audio the TV may not play, named when no track of the file is one it plays. */
    riskyAudio: string[]
    /** What the TV's decoders don't handle about the video. */
    videoProblems: string[]
    /** The file's audio tracks in file order, for the web player. */
    audioTracks: TVAudioTrack[]
}

export function describeStreamCodecs(metadata: MKVParser_Metadata | undefined): StreamCodecs {
    const video = metadata?.videoTracks?.[0]
    const audioTracks = (metadata?.audioTracks ?? []).map(track => describeTVAudioTrack({
        codec: mkvAudioCodec(track.codecID),
        channels: track.audio?.Channels || undefined,
        language: track.languageIETF || track.language,
        title: track.name,
        default: track.default,
    }))
    const unique = (labels: string[]) => Array.from(new Set(labels))
    const anyPlays = audioTracks.some(track => track.support === "plays")
    const problem = videoTrackProblem(video)
    const size = video?.video
    return {
        video: problem ?? (video ? videoCodecName(video.codecID) : undefined),
        resolution: size?.PixelWidth && size.PixelHeight ? `${size.PixelWidth}×${size.PixelHeight}` : undefined,
        audio: unique(audioTracks.map(track => track.codec)),
        riskyAudio: anyPlays ? [] : unique(audioTracks.filter(track => track.support !== "plays").map(track => track.codec)),
        videoProblems: problem ? [problem] : [],
        audioTracks,
    }
}

const hasFlac = (labels: string[]) => labels.some(label => label.startsWith("FLAC"))

/** A warning for the start of a stream whose audio the TV may not play, or null. */
export function streamAudioWarning(codecs: StreamCodecs): string | null {
    if (codecs.riskyAudio.length === 0) return null
    const what = `This TV may not play ${codecs.riskyAudio.join(" or ")} audio`
    const multichannelFlac = codecs.audioTracks.some(track => track.support === "broken" && track.codec.startsWith("FLAC"))
    return multichannelFlac
        ? `${what}: LG TVs often play FLAC with more than two channels silently. If there's no sound, pick a release with AAC, AC-3 or E-AC-3 audio.`
        : `${what}. If the video doesn't start, pick a release with AAC, AC-3 or E-AC-3 audio.`
}

/**
 * The error for a torrent or debrid stream the TV could not play: what is
 * in it, what LG's decoders don't take, and what to do. The server
 * (Seanime 3.10) transcodes library files only.
 */
export function streamFailureMessage(codecs: StreamCodecs): string {
    const what = [codecs.video, ...codecs.audio].filter(Boolean).join(", ")
    const parts = [`The TV could not play this stream${what ? ` (${what})` : ""}.`]
    if (codecs.videoProblems.length > 0) parts.push(`LG TVs don't decode ${codecs.videoProblems.join(" or ")}.`)
    if (hasFlac(codecs.riskyAudio)) {
        parts.push("LG lists FLAC for music files only, and many LG TVs don't play it in a video.")
    } else if (codecs.riskyAudio.length > 0) {
        parts.push(`LG TVs may not play ${codecs.riskyAudio.join(" or ")} audio in a video.`)
    }

    const wanted: string[] = []
    if (codecs.videoProblems.length > 0) wanted.push("8-bit H.264 or HEVC video")
    if (codecs.riskyAudio.length > 0) wanted.push("AAC, AC-3 or E-AC-3 audio")
    const marked = hasFlac(codecs.riskyAudio) ? " (the release list marks FLAC ones)" : ""
    parts.push(`Seanime can't transcode torrent or debrid streams, so pick another release${wanted.length ? ` with ${wanted.join(" and ")}` : ""}${marked}.`)
    parts.push("Or download the episode to your library from Seanime's web interface: the server can transcode library files.")
    return parts.join(" ")
}
