import type { AL_BaseAnime } from "@/api/generated/types"
import { useServerStatus } from "@/atoms/server.atoms"
import {
    getCurrentSeasonLabel,
    getPreviousSeasonLabel,
    useDiscoverCurrentSeasonAnime,
    useDiscoverMissedSequels,
    useDiscoverPastSeasonAnime,
    useDiscoverRecentlyAired,
    useDiscoverTrendingAnime,
    useDiscoverTrendingMovies,
    useDiscoverUpcomingAnime,
} from "@/components/features/discover/discover-queries"
import { OfflineBanner } from "@/components/shared/offline-banner"
import { TV, TVButton, TVHeroCarousel, type TVHeroItem, TVPageSkeleton, TVPillButton, TVShelf, tvSize } from "@/components/tv"
import { trendingHeroItem } from "@/components/tv/tv-hero-items"
import { TVNavScrim } from "@/components/tv/tv-nav-scrim"
import { useIsServerConnected } from "@/lib/offline"
import { SEARCH_MEDIA_GENRES } from "@/lib/search/search-constants"
import Ionicons from "@expo/vector-icons/Ionicons"
import { router, useIsFocused } from "expo-router"
import * as React from "react"
import { FlatList, Pressable, Text, TVFocusGuideView, View } from "react-native"
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated"

type Shelf = {
    key: string
    title: string
    media: AL_BaseAnime[]
}

export function TVDiscoverScreen() {
    const scrollY = useSharedValue(0)
    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y
        },
    })
    const isFocused = useIsFocused()
    const isConnected = useIsServerConnected()
    const serverStatus = useServerStatus()
    const [genre, setGenre] = React.useState<string | null>(null)
    const [searchButton, setSearchButton] = React.useState<React.ElementRef<typeof Pressable> | null>(null)
    const trending = useDiscoverTrendingAnime(true, genre ? [genre] : undefined)
    const current = useDiscoverCurrentSeasonAnime()
    const recent = useDiscoverRecentlyAired()
    const past = useDiscoverPastSeasonAnime()
    const upcoming = useDiscoverUpcomingAnime()
    const movies = useDiscoverTrendingMovies()
    const missed = useDiscoverMissedSequels()
    const hideScore = serverStatus?.settings?.anilist?.hideAudienceScore ?? false

    const trendingMedia = React.useMemo(() => trending.data?.Page?.media?.filter(Boolean) as AL_BaseAnime[] ?? [], [trending.data?.Page?.media])

    const heroItems = React.useMemo<TVHeroItem[]>(() => (
        trendingMedia
            .filter(media => !!media.bannerImage)
            .slice(0, 12)
            .map(media => trendingHeroItem(media, { hideScore }))
    ), [hideScore, trendingMedia])

    const shelves = React.useMemo<Shelf[]>(() => [
        {
            key: "trending",
            title: "Trending right now",
            media: trendingMedia,
        },
        {
            key: "recent",
            title: "Aired recently",
            media: recent.media,
        },
        {
            key: "season",
            title: `Top of ${getCurrentSeasonLabel()}`,
            media: current.data?.Page?.media?.filter(Boolean) as AL_BaseAnime[] ?? [],
        },
        {
            key: "past-season",
            title: `Best of ${getPreviousSeasonLabel()}`,
            media: past.data?.Page?.media?.filter(Boolean) as AL_BaseAnime[] ?? [],
        },
        {
            key: "upcoming",
            title: "Coming soon",
            media: upcoming.data?.Page?.media?.filter(Boolean) as AL_BaseAnime[] ?? [],
        },
        {
            key: "movies",
            title: "Trending movies",
            media: movies.data?.Page?.media?.filter(Boolean) as AL_BaseAnime[] ?? [],
        },
        {
            key: "missed",
            title: "You might have missed",
            media: missed.data ?? [],
        },
    ].filter(shelf => shelf.media.length > 0), [
        current.data?.Page?.media,
        missed.data,
        movies.data?.Page?.media,
        past.data?.Page?.media,
        recent.media,
        trendingMedia,
        upcoming.data?.Page?.media,
    ])

    const genreOptions = React.useMemo(() => [null, ...SEARCH_MEDIA_GENRES], [])

    if (!isConnected) {
        return (
            <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
                <OfflineBanner />
                <View
                    style={{
                        flex: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: tvSize(10),
                        paddingHorizontal: TV.gutter,
                    }}
                >
                    <Ionicons name="cloud-offline-outline" size={tvSize(48)} color="rgba(255,255,255,0.2)" />
                    <Text className="font-semibold text-white/45" style={{ fontSize: tvSize(22) }}>
                        Connect to your server to discover content
                    </Text>
                </View>
            </View>
        )
    }

    if (trending.isLoading && heroItems.length === 0 && shelves.length === 0) {
        return <TVPageSkeleton hero />
    }

    return (
        <View className="flex-1 bg-background">
            <Animated.ScrollView
                style={{ flex: 1 }}
                fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                contentContainerStyle={{ paddingBottom: tvSize(80), gap: TV.sectionGap }}
                showsVerticalScrollIndicator={false}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
            >
                <TVHeroCarousel
                    items={heroItems}
                    active={isFocused}
                    preferred
                    loading={trending.isLoading || trending.isFetching}
                />

                <View style={{ gap: tvSize(14) }}>
                    <TVFocusGuideView
                        autoFocus={isFocused}
                        destinations={searchButton ? [searchButton] : undefined}
                        style={{
                            paddingHorizontal: TV.gutter,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}
                    >
                        <View>
                            <Text className="font-bold text-white" style={{ marginTop: tvSize(3), fontSize: tvSize(28) }}>
                                Genre
                            </Text>
                        </View>
                        <TVButton
                            ref={setSearchButton}
                            label="Search anime"
                            variant="secondary"
                            size="compact"
                            icon={<Ionicons name="search" size={tvSize(20)} color="white" />}
                            onPress={() => router.push({
                                pathname: "/(app)/(tabs)/discover/search",
                                params: { type: "anime" },
                            })}
                        />
                    </TVFocusGuideView>
                    <TVFocusGuideView trapFocusLeft trapFocusRight>
                        <FlatList
                            horizontal
                            data={genreOptions}
                            keyExtractor={item => item ?? "all"}
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{
                                paddingHorizontal: TV.gutter,
                                paddingTop: tvSize(8),
                                paddingBottom: tvSize(10),
                                gap: tvSize(10),
                            }}
                            renderItem={({ item, index }) => (
                                <TVPillButton
                                    label={item ?? "All"}
                                    active={genre === item}
                                    preferred={heroItems.length === 0 && index === 0}
                                    onPress={() => setGenre(item)}
                                />
                            )}
                        />
                    </TVFocusGuideView>
                </View>

                {shelves.map((shelf, index) => (
                    <TVShelf
                        key={shelf.key}
                        title={shelf.title}
                        media={shelf.media}
                        showAudienceScore
                        first={heroItems.length === 0 && index === 0}
                    />
                ))}
            </Animated.ScrollView>
            <TVNavScrim scrollY={scrollY} />
        </View>
    )
}
