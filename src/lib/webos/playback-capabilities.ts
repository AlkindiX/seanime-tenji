/**
 * Decides whether a library file can be sent to the TV as it is (direct
 * play) or has to be transcoded by the server first.
 *
 * The rules follow LG's webOS 6 video spec: H.264 up to High profile (8-bit
 * 4:2:0 only, so no Hi10P), HEVC Main/Main10, VP9 and AV1. They err towards
 * direct play: a file that would play is never transcoded for a guess, and a
 * file that fails anyway falls back to transcoding when the decoder reports it.
 *
 * No react-native imports, so the node tests can load it.
 */

/** The parts of the server's `MediaInfo` this module reads. */
export type PlaybackMediaInfo = {
    video?: {
        codec: string
        mimeCodec?: string | null
        width?: number
        height?: number
        pixFmt?: string
    } | null
    audios?: Array<{ codec: string; mimeCodec?: string | null; channels?: number }> | null
}

/** What the browser says it can decode (MediaSource.isTypeSupported / canPlayType). */
export type CodecProbe = {
    isTypeSupported: (type: string) => boolean
}

/** Facts from the TV itself (device-info.ts); unknown fields are left out. */
export type PlaybackDevice = {
    uhd?: boolean
    dolbyVision?: boolean
}

export type PlaybackDecision = {
    mode: "direct" | "transcode"
    /** What the TV can't play, as short phrases ("10-bit H.264 (Hi10P)", "Dolby Vision"). */
    reasons: string[]
    /** Audio the TV may not play. Only a warning: the TV's file pipeline often plays codecs MSE refuses. */
    audioWarnings: string[]
}

/** Codecs the TV's decoders are documented to handle, checked by rule rather than by probe. */
const KNOWN_VIDEO_CODECS = new Set(["h264", "hevc", "vp9", "av1", "mpeg2video", "mpeg4"])

/** Codec strings for files where the server has no `mimeCodec` (it often has none for VP9 or AV1). */
const FALLBACK_VIDEO_CODECS: Record<string, string> = {
    h264: "avc1.640028",
    hevc: "hvc1.1.6.L120.90",
    vp9: "vp09.00.40.08",
    av1: "av01.0.08M.08",
    vp8: "vp8",
    theora: "theora",
    mpeg2video: "mp2v",
    mpeg4: "mp4v.20.9",
}

const FALLBACK_AUDIO_CODECS: Record<string, string> = {
    aac: "mp4a.40.2",
    mp3: "mp4a.40.34",
    ac3: "ac-3",
    eac3: "ec-3",
    opus: "opus",
    flac: "flac",
    vorbis: "vorbis",
    dts: "dtsc",
    truehd: "mlpa",
}

const AUDIO_NAMES: Record<string, string> = {
    aac: "AAC",
    mp3: "MP3",
    ac3: "AC-3",
    eac3: "E-AC-3",
    opus: "Opus",
    flac: "FLAC",
    vorbis: "Vorbis",
    dts: "DTS",
    truehd: "TrueHD",
}

const VIDEO_NAMES: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    vp9: "VP9",
    av1: "AV1",
    vp8: "VP8",
    mpeg2video: "MPEG-2",
    mpeg4: "MPEG-4",
}

export function videoCodecName(codec: string) {
    return VIDEO_NAMES[codec.toLowerCase()] ?? codec.toUpperCase()
}

export function audioCodecName(codec: string) {
    return AUDIO_NAMES[codec.toLowerCase()] ?? codec.toUpperCase()
}

/** Bit depth from an ffmpeg pixel format: yuv420p -> 8, yuv420p10le -> 10. */
export function pixelBitDepth(pixFmt: string | undefined) {
    const match = /p(\d{2})(le|be)?$/.exec(pixFmt ?? "")
    return match ? Number(match[1]) : 8
}

/** Chroma subsampling from an ffmpeg pixel format, "420" when it can't tell. */
export function pixelChroma(pixFmt: string | undefined) {
    if (pixFmt?.startsWith("gbr")) return "444"
    const match = /^yuvj?(4[24][024])/.exec(pixFmt ?? "")
    return match ? match[1] : "420"
}

/** H.264 profile_idc from an `avc1.PPCCLL` codec string. */
export function h264ProfileIdc(mimeCodec: string | null | undefined) {
    const match = /^avc[13]\.([0-9a-f]{2})[0-9a-f]{4}$/i.exec(mimeCodec ?? "")
    return match ? parseInt(match[1], 16) : null
}

/** High 10, High 4:2:2 and High 4:4:4 Predictive: beyond the TV's H.264 decoder. */
const H264_UNSUPPORTED_PROFILES: Record<number, string> = {
    0x6E: "10-bit H.264 (Hi10P)",
    0x7A: "H.264 High 4:2:2",
    0xF4: "H.264 High 4:4:4",
}

function isDolbyVision(mimeCodec: string | null | undefined, codec: string) {
    return /^(dvhe|dvh1|dvav|dva1|dav1)\b/i.test(mimeCodec ?? "") || /^(dvhe|dvh1)$/i.test(codec)
}

export function videoMimeType(codec: string, mimeCodec?: string | null) {
    const value = mimeCodec?.trim() || FALLBACK_VIDEO_CODECS[codec.toLowerCase()] || codec.toLowerCase()
    return `video/mp4; codecs="${value}"`
}

export function audioMimeType(codec: string, mimeCodec?: string | null) {
    const value = mimeCodec?.trim() || FALLBACK_AUDIO_CODECS[codec.toLowerCase()] || codec.toLowerCase()
    return `audio/mp4; codecs="${value}"`
}

function safeProbe(probe: CodecProbe, type: string) {
    try {
        return probe.isTypeSupported(type)
    } catch {
        return false
    }
}

export function decidePlayback(
    mediaInfo: PlaybackMediaInfo | null | undefined,
    probe: CodecProbe,
    device: PlaybackDevice = {},
): PlaybackDecision {
    const reasons: string[] = []
    const audioWarnings: string[] = []
    const video = mediaInfo?.video

    if (video?.codec) {
        const codec = video.codec.toLowerCase()
        const depth = pixelBitDepth(video.pixFmt)
        const chroma = pixelChroma(video.pixFmt)

        if (isDolbyVision(video.mimeCodec, codec)) {
            if (device.dolbyVision === false) reasons.push("Dolby Vision")
        } else if (codec === "h264") {
            const profile = h264ProfileIdc(video.mimeCodec)
            if (profile !== null && H264_UNSUPPORTED_PROFILES[profile]) {
                reasons.push(H264_UNSUPPORTED_PROFILES[profile])
            } else if (depth > 8) {
                reasons.push(`${depth}-bit H.264${depth === 10 ? " (Hi10P)" : ""}`)
            } else if (chroma !== "420") {
                reasons.push(`H.264 ${chroma.split("").join(":")}`)
            }
        } else if (codec === "hevc") {
            // Main and Main10 only; range extensions (12-bit, 4:2:2, 4:4:4) are not decoded.
            if (depth > 10) reasons.push(`${depth}-bit HEVC`)
            else if (chroma !== "420") reasons.push(`HEVC ${chroma.split("").join(":")}`)
        } else if (!KNOWN_VIDEO_CODECS.has(codec) && !safeProbe(probe, videoMimeType(codec, video.mimeCodec))) {
            reasons.push(`${videoCodecName(codec)} video`)
        }

        const width = video.width ?? 0
        const height = video.height ?? 0
        if (device.uhd === false && (width > 1920 || height > 1088)) {
            reasons.push(`${width}×${height} video`)
        }
    }

    const seen = new Set<string>()
    for (const audio of mediaInfo?.audios ?? []) {
        const codec = audio.codec?.toLowerCase()
        if (!codec || seen.has(codec)) continue
        seen.add(codec)
        if (!safeProbe(probe, audioMimeType(codec, audio.mimeCodec))) {
            audioWarnings.push(`${audioCodecName(codec)} audio may not play on this TV`)
        }
    }

    return { mode: reasons.length > 0 ? "transcode" : "direct", reasons, audioWarnings }
}

/** One line for the stats overlay: "h264 · yuv420p10le · 1920×1080". */
export function describeVideo(video: PlaybackMediaInfo["video"]) {
    if (!video?.codec) return undefined
    const parts = [video.mimeCodec || video.codec]
    if (video.pixFmt) parts.push(video.pixFmt)
    return parts.join(" · ")
}

export function describeAudio(audios: PlaybackMediaInfo["audios"]) {
    const first = audios?.[0]
    if (!first?.codec) return undefined
    const channels = first.channels ? ` · ${first.channels} ch` : ""
    const more = (audios?.length ?? 0) > 1 ? ` (+${(audios?.length ?? 1) - 1})` : ""
    return `${first.codec}${channels}${more}`
}

/** Formats worth naming on the settings screen, with a type the probe can check. */
export const NOTABLE_VIDEO_FORMATS: Array<{ name: string; type: string }> = [
    { name: "H.264", type: 'video/mp4; codecs="avc1.640028"' },
    { name: "HEVC Main10", type: 'video/mp4; codecs="hvc1.2.4.L153.B0"' },
    { name: "VP9", type: 'video/mp4; codecs="vp09.00.40.08"' },
    { name: "AV1", type: 'video/mp4; codecs="av01.0.08M.08"' },
    { name: "Dolby Vision", type: 'video/mp4; codecs="dvh1.05.06"' },
]

export function decodableFormats(probe: CodecProbe) {
    return NOTABLE_VIDEO_FORMATS.filter(format => safeProbe(probe, format.type)).map(format => format.name)
}

/** MediaSource.isTypeSupported first (what hls.js plays through), then the <video> element's canPlayType. */
export function browserCodecProbe(): CodecProbe {
    let video: HTMLVideoElement | null = null
    return {
        isTypeSupported(type) {
            if (typeof MediaSource !== "undefined" && typeof MediaSource.isTypeSupported === "function"
                && MediaSource.isTypeSupported(type)) {
                return true
            }
            if (typeof document === "undefined") return false
            video ??= document.createElement("video")
            return video.canPlayType(type) !== ""
        },
    }
}
