import type { AL_BaseAnime } from "@/api/generated/types"
import type { TVHeroItem } from "@/components/tv/tv-hero-carousel"
import { cleanHtml, mediaTitle } from "@/lib/media-metadata"
import { router } from "expo-router"

type TrendingHeroOptions = {
    hideScore: boolean
    /** A line under the title, e.g. the show's place in the trending list. */
    subtitle?: string
}

/** A hero slide for a show trending on AniList; its button opens the show. */
export function trendingHeroItem(media: AL_BaseAnime, { hideScore, subtitle }: TrendingHeroOptions): TVHeroItem {
    return {
        key: `trending-${media.id}`,
        image: media.bannerImage
            ?? media.coverImage?.extraLarge
            ?? media.coverImage?.large,
        kicker: "Trending right now",
        title: mediaTitle(media),
        subtitle,
        meta: [
            media.seasonYear,
            media.format?.replaceAll("_", " "),
            media.genres?.slice(0, 3).join("  ·  "),
        ].filter(Boolean).join("  ·  "),
        description: cleanHtml(media.description),
        score: hideScore ? undefined : media.meanScore,
        actionLabel: "Open anime",
        onAction: () => router.push(`/(app)/entry/anime/${media.id}`),
    }
}
