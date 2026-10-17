import type { MpvExternalSubtitle } from "expo-mpv-player"
import type { MobilePlaybackSource } from "./types"

const NONE: MpvExternalSubtitle[] = []

/**
 * mpv reads subtitle tracks straight from the stream, so native builds have
 * nothing to add. See extracted-subtitles.web.ts for the webOS build.
 */
export function useExtractedSubtitles(_source: MobilePlaybackSource | null): MpvExternalSubtitle[] | undefined {
    return NONE
}
