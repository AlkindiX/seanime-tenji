/**
 * What the TV start screen (Anime tab) shows besides the library on webOS:
 * the shows trending on AniList, after the ones to continue watching.
 * Kept free of React Native so the rules can be unit tested.
 */

/** The hero is filled up to this many slides with trending shows; continue watching keeps its own cap. */
export const HOME_HERO_MAX_SLIDES = 8

export type HomeTrendingItem<T> = {
    media: T
    /** Position in AniList's trending list, from 1, before shows to continue were taken out. */
    rank: number
}

type LibraryListLike = {
    type?: string | null
    entries?: readonly ({ mediaId?: number | null; media?: { id: number } | null } | null | undefined)[] | null
}

/**
 * The shows the start screen already has near the top: the ones to continue
 * watching and the "Currently watching" list (the trending row sits right
 * after it). Trending leaves them out.
 */
export function homeTrendingSkipIds(
    continueIds: Iterable<number>,
    libraryLists: readonly (LibraryListLike | null | undefined)[],
): Set<number> {
    const skip = new Set(continueIds)
    for (const list of libraryLists) {
        if (list?.type !== "CURRENT") continue
        for (const entry of list.entries ?? []) {
            const id = entry?.media?.id ?? entry?.mediaId
            if (typeof id === "number") skip.add(id)
        }
    }
    return skip
}

/**
 * Trending shows in AniList's order, each once, without the ones already on
 * the screen (see homeTrendingSkipIds).
 */
export function pickHomeTrending<T extends { id: number }>(
    trending: readonly (T | null | undefined)[] | null | undefined,
    skipIds: Iterable<number>,
): HomeTrendingItem<T>[] {
    if (!trending?.length) return []
    const skip = new Set(skipIds)
    const items: HomeTrendingItem<T>[] = []
    trending.forEach((media, index) => {
        if (!media || skip.has(media.id)) return
        skip.add(media.id)
        items.push({ media, rank: index + 1 })
    })
    return items
}

/**
 * The trending shows that follow the continue-watching slides in the hero:
 * only those with a banner (a cover stretched to 1920 px looks broken), and
 * only as many as fit under `max` slides in all. With nothing to continue,
 * trending fills the hero.
 */
export function pickTrendingHeroItems<T extends { bannerImage?: string | null }>(
    trending: readonly HomeTrendingItem<T>[],
    continueSlideCount: number,
    max: number = HOME_HERO_MAX_SLIDES,
): HomeTrendingItem<T>[] {
    const room = max - Math.max(0, continueSlideCount)
    if (room <= 0) return []
    return trending.filter(item => !!item.media.bannerImage).slice(0, room)
}

/**
 * Where the "Trending now" row goes among the library rows: right after
 * "Currently watching", so the rows the user knows keep their order, or first
 * when there is no such row.
 */
export function trendingShelfIndex(shelfKeys: readonly string[]): number {
    const current = shelfKeys.indexOf("CURRENT")
    return current === -1 ? 0 : current + 1
}
