import type { MobilePlaybackSource, WebPlaybackPlan } from "./types"

const NATIVE_PLAN: WebPlaybackPlan = { externalSubtitles: [] }

/**
 * mpv reads subtitle tracks and chapters straight from the stream and
 * decodes everything, so native builds have nothing to plan. See
 * web-playback-plan.web.ts for the webOS build.
 */
export function useWebPlaybackPlan(_source: MobilePlaybackSource | null): WebPlaybackPlan | undefined {
    return NATIVE_PLAN
}
