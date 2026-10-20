/**
 * Which audio LG's webOS player plays inside a video file (an MKV or MP4
 * handed to a <video>, which goes to the TV's own media pipeline).
 *
 * LG's video specs for webOS 6, 22 and 23 list Dolby Digital, Dolby Digital
 * Plus, AAC, PCM, DTS (some models) and MPEG audio for MKV; FLAC only as a
 * music file, in stereo. What users report beyond that: stereo FLAC in MKV
 * plays on a C1 and a C3 (Jellyfin direct-plays it), FLAC with more channels
 * plays silently or as the front left and right only, and webOS leaves
 * TrueHD out of a file's audio tracks. A TV may also wait forever on audio
 * it doesn't take. Opus is listed for MKV from webOS 24 only.
 *
 * No react-native imports, so the node tests can load it.
 */

/** plays: listed by LG. risky: not listed, may or may not play. broken: known to give no (or partial) sound. */
export type TVAudioSupport = "plays" | "risky" | "broken"

/** Matroska codec ids -> the ffmpeg names the server's media info uses. */
const MKV_AUDIO_CODECS: Array<[RegExp, string]> = [
    [/^A_AAC/, "aac"],
    [/^A_EAC3/, "eac3"],
    [/^A_AC3/, "ac3"],
    [/^A_DTS/, "dts"],
    [/^A_TRUEHD/, "truehd"],
    [/^A_MLP/, "truehd"],
    [/^A_FLAC/, "flac"],
    [/^A_OPUS/, "opus"],
    [/^A_VORBIS/, "vorbis"],
    [/^A_MPEG\/L3/, "mp3"],
    [/^A_MPEG\/L2/, "mp2"],
    [/^A_PCM/, "pcm"],
]

const NAMES: Record<string, string> = {
    aac: "AAC",
    ac3: "AC-3",
    eac3: "E-AC-3",
    dts: "DTS",
    truehd: "TrueHD",
    flac: "FLAC",
    opus: "Opus",
    vorbis: "Vorbis",
    mp3: "MP3",
    mp2: "MP2",
    pcm: "PCM",
}

/** "A_FLAC" -> "flac"; unknown ids lose their "A_" and are lower-cased. */
export function mkvAudioCodec(codecId: string) {
    return MKV_AUDIO_CODECS.find(([pattern]) => pattern.test(codecId))?.[1] ?? codecId.replace(/^A_/, "").toLowerCase()
}

/** ffmpeg's many PCM variants (pcm_s16le, ...) count as one. */
function normalize(codec: string) {
    const lower = codec.toLowerCase()
    return lower.startsWith("pcm") ? "pcm" : lower
}

export function audioCodecLabel(codec: string) {
    const normalized = normalize(codec)
    return NAMES[normalized] ?? codec.toUpperCase()
}

/** 2 -> "2.0", 6 -> "5.1"; nothing when the count is unknown. */
export function channelLayout(channels: number | undefined) {
    if (!channels || channels < 1) return undefined
    if (channels === 1) return "mono"
    if (channels === 2) return "2.0"
    if (channels === 3) return "2.1"
    if (channels === 6) return "5.1"
    if (channels === 8) return "7.1"
    return `${channels} ch`
}

/** "FLAC 5.1", or "FLAC" when the channel count is unknown. */
export function audioTrackLabel(codec: string, channels?: number) {
    const layout = channelLayout(channels)
    return layout ? `${audioCodecLabel(codec)} ${layout}` : audioCodecLabel(codec)
}

export function tvAudioSupport(codec: string, channels?: number): TVAudioSupport {
    switch (normalize(codec)) {
        case "aac":
        case "ac3":
        case "eac3":
        case "mp3":
        case "mp2":
            return "plays"
        case "flac":
            return channels !== undefined && channels > 2 ? "broken" : "risky"
        case "truehd":
            return "broken"
        default:
            return "risky"
    }
}

/** webOS leaves these out of a file's audio tracks (and starts on another one). */
export function unlistedOnWebOS(codec: string) {
    return normalize(codec) === "truehd"
}

/** An audio track of a file, as the web player is told about it. */
export type TVAudioTrack = {
    /** What it is, as shown with the track: "FLAC 5.1". */
    codec: string
    language?: string
    title?: string
    default?: boolean
    support: TVAudioSupport
    /** Left out of the browser's audio tracks on webOS. */
    unlisted?: boolean
}

export function describeTVAudioTrack(track: { codec: string; channels?: number; language?: string; title?: string; default?: boolean }): TVAudioTrack {
    const described: TVAudioTrack = {
        codec: audioTrackLabel(track.codec, track.channels),
        language: track.language || undefined,
        title: track.title || undefined,
        default: track.default || undefined,
        support: tvAudioSupport(track.codec, track.channels),
    }
    if (unlistedOnWebOS(track.codec)) described.unlisted = true
    return described
}
