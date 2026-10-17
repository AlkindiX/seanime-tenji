/**
 * Small decisions of the web player that don't need a <video>, kept apart
 * so the node tests can check them.
 */

/** HTMLMediaElement.NETWORK_NO_SOURCE */
const NETWORK_NO_SOURCE = 3

/**
 * When the app comes back from the background: has the TV taken the media
 * pipeline away (an error, or the element lost its resource)? Then the
 * source has to be loaded again.
 */
export function shouldReload(readyState: number, networkState: number, hasError: boolean) {
    return hasError || readyState === 0 || networkState === NETWORK_NO_SOURCE
}

/**
 * The `type` of a <source> that asks the webOS media pipeline to start at
 * `startSeconds` (LG's "mediaOption" parameter, `playTime.start` in ms).
 * Seeking after loadedmetadata instead makes the TV buffer from the start
 * of the file first.
 */
export function mediaOptionType(startSeconds: number, mimeType = "video/mp4") {
    const option = { option: { transmission: { playTime: { start: Math.round(startSeconds * 1000) } } } }
    return `${mimeType};mediaOption=${encodeURI(JSON.stringify(option))}`
}

/**
 * Indexes of HLS levels taller than `maxHeight`, highest index first (the
 * order to remove them in). None when every level is taller: playing
 * something beats refusing the stream.
 */
export function levelsAboveHeight(heights: readonly number[], maxHeight: number) {
    const drop: number[] = []
    for (let i = heights.length - 1; i >= 0; i--) {
        if (heights[i] > maxHeight) drop.push(i)
    }
    return drop.length === heights.length ? [] : drop
}

/** What asking for a source again found out: its HTTP status, or why there is none. */
export type SourceProbe = { status: number } | "unreachable" | "unknown"

/**
 * The error to report for a source that failed to load (MediaError 4), when
 * the cause was the server or the network rather than the format. `null`:
 * the source answered, so the TV could not play it.
 */
export function loadFailure(probe: SourceProbe): { error: string; code: number } | null {
    if (probe === "unknown") return null
    // MEDIA_ERR_NETWORK, so it isn't taken for a format the TV can't decode.
    const code = 2
    if (probe === "unreachable") return { error: "The TV could not reach the server for this video", code }
    const { status } = probe
    if (status < 400) return null
    if (status === 401 || status === 403) {
        return { error: `The server refused access to this video (HTTP ${status}). The link may have expired; try opening it again.`, code }
    }
    if (status === 404 || status === 410) return { error: `The server could not find this video (HTTP ${status})`, code }
    return { error: `The server could not send this video (HTTP ${status})`, code }
}
