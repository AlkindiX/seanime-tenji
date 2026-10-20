import type {
    AL_BaseAnime,
    Anime_EntryLibraryData,
    Anime_EntryListData,
    Anime_NakamaEntryLibraryData,
} from "@/api/generated/types"
import { TVMediaCard } from "@/components/tv/tv-media-card"
import { TVSectionHeader } from "@/components/tv/tv-section-header"
import { MEDIA_ROW_LAYOUT, TV, tvSize } from "@/components/tv/tv-scale"
import { router } from "expo-router"
import * as React from "react"
import { FlatList, TVFocusGuideView, View } from "react-native"

export type TVMediaMeta = {
    listData?: Anime_EntryListData
    libraryData?: Anime_EntryLibraryData
    nakamaLibraryData?: Anime_NakamaEntryLibraryData
}

type TVShelfProps = {
    title: string
    media: AL_BaseAnime[]
    first?: boolean
    badgeById?: ReadonlyMap<number, string>
    metaById?: ReadonlyMap<number, TVMediaMeta>
    showAudienceScore?: boolean
    hideProgress?: boolean
    hideLibraryBadge?: boolean
    onMediaPress?: (media: AL_BaseAnime) => void
}

export const TVShelf = React.memo(function TVShelf({
    title,
    media,
    first,
    badgeById,
    metaById,
    showAudienceScore,
    hideProgress,
    hideLibraryBadge,
    onMediaPress,
}: TVShelfProps) {
    const open = React.useCallback((id: number) => {
        router.push(`/(app)/entry/anime/${id}`)
    }, [])

    const renderItem = React.useCallback(({ item, index }: { item: AL_BaseAnime; index: number }) => {
        const meta = metaById?.get(item.id)
        return (
            <TVMediaCard
                media={item}
                width={tvSize(220)}
                preferred={first && index === 0}
                badge={badgeById?.get(item.id)}
                listData={meta?.listData}
                libraryData={meta?.libraryData}
                nakamaLibraryData={meta?.nakamaLibraryData}
                showAudienceScore={showAudienceScore}
                hideProgress={hideProgress}
                hideLibraryBadge={hideLibraryBadge}
                onPress={() => onMediaPress ? onMediaPress(item) : open(item.id)}
            />
        )
    }, [
        badgeById,
        first,
        hideLibraryBadge,
        hideProgress,
        metaById,
        onMediaPress,
        open,
        showAudienceScore,
    ])

    if (media.length === 0) return null

    return (
        <View style={{ gap: tvSize(12) }}>
            <TVSectionHeader title={title} count={media.length} />
            <TVFocusGuideView trapFocusLeft trapFocusRight>
                <FlatList
                    horizontal
                    data={media}
                    renderItem={renderItem}
                    keyExtractor={item => String(item.id)}
                    getItemLayout={MEDIA_ROW_LAYOUT}
                    snapToAlignment="item"
                    snapToItemPadding={TV.gutter}
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{
                        paddingHorizontal: TV.gutter,
                        paddingTop: tvSize(10),
                        paddingBottom: tvSize(14),
                        gap: TV.cardGap,
                    }}
                    showsHorizontalScrollIndicator={false}
                    removeClippedSubviews={false}
                    initialNumToRender={10}
                    maxToRenderPerBatch={8}
                    windowSize={5}
                />
            </TVFocusGuideView>
        </View>
    )
})
