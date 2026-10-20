/**
 * Subtitle tracks whose cues arrive while the video plays, for the web player.
 *
 * Browsers can't read the subtitle tracks inside an MKV, so for streams the
 * Seanime server parses the file and sends the lines over its WebSocket. The
 * app registers a feed under an id and passes that id as
 * `MpvVideoSource.subtitleFeed`; the player lists the feed's tracks, shows
 * their cues as they come in, and tells the feed when the video loaded or
 * seeked (the server starts reading subtitles from there).
 */
import type { SubtitleCue } from "./web/subtitles"

export type SubtitleFeedCue = SubtitleCue

/** One ASS packet as Matroska stores it: "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text". */
export type SubtitleFeedAssChunk = {
    data: string
    /** Milliseconds. */
    start: number
    duration: number
}

export type SubtitleFeedTrack = {
    title?: string
    lang?: string
    codec?: string
    /** Sorted by start time; the feed adds to it in place. */
    cues: SubtitleFeedCue[]
    /**
     * For ASS/SSA tracks, what libass needs to draw them with their styling:
     * the script header (the track's CodecPrivate) and the packets so far,
     * in arrival order, added to in place.
     */
    ass?: { header: string; chunks: SubtitleFeedAssChunk[] }
}

export type SubtitleFeedPlayerEvent = {
    type: "loadedmetadata" | "seeked"
    position: number
    duration: number
    paused: boolean
}

export type SubtitleFeed = {
    tracks: SubtitleFeedTrack[]
    /** Called when cues were added to any track. */
    subscribe: (listener: () => void) => () => void
    onPlayerEvent?: (event: SubtitleFeedPlayerEvent) => void
}

const feeds = new Map<string, SubtitleFeed>()

export function registerSubtitleFeed(id: string, feed: SubtitleFeed): () => void {
    feeds.set(id, feed)
    return () => {
        if (feeds.get(id) === feed) feeds.delete(id)
    }
}

export function getSubtitleFeed(id: string | undefined): SubtitleFeed | undefined {
    return id ? feeds.get(id) : undefined
}
