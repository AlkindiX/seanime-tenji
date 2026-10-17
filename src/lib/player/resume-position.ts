import type { Continuity_WatchHistory } from "@/api/generated/types"

/**
 * Where "continue watching" picks up an episode: the watch history's
 * position when it is for this episode and between 2 % and 90 % in;
 * otherwise null (start from the beginning).
 */
export function getWatchHistoryResumePosition(
    watchHistory: Continuity_WatchHistory | null | undefined,
    source: { mediaId: number; episodeNumber: number },
): number | null {
    const item = watchHistory?.[source.mediaId]
    if (!item || item.episodeNumber !== source.episodeNumber) return null
    const ratio = item.duration > 0 ? item.currentTime / item.duration : 0
    return ratio < 0.9 && ratio >= 0.02 ? item.currentTime : null
}
