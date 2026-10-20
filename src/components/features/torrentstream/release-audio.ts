/**
 * Audio a release's name says it carries that LG webOS TVs don't play inside
 * a video file. FLAC is the common case: Blu-ray rips often keep the disc's
 * lossless audio as FLAC, the TV's player then refuses the file (or waits
 * forever), and Seanime 3.10 can't transcode a torrent or debrid stream.
 *
 * No react-native imports, so the node tests can load it.
 */
import type { Habari_Metadata } from "@/api/generated/types"

/** "FLAC" as a word, also run into a channel count ("FLACx2", "FLAC2.0"); not inside another word. */
const FLAC_IN_NAME = /(^|[^a-z0-9])flac(?=$|[^a-z]|x\d)/i

/** What the name says about audio the TV can't play, or null when it says nothing of the kind. */
export function releaseAudioProblem(name: string, metadata?: Pick<Habari_Metadata, "audio_term"> | null): "FLAC" | null {
    if (FLAC_IN_NAME.test(name)) return "FLAC"
    if (metadata?.audio_term?.some(term => /flac/i.test(term))) return "FLAC"
    return null
}
