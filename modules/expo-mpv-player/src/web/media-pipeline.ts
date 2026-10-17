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
