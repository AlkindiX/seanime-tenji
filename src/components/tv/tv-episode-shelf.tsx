import type { Anime_Episode } from "@/api/generated/types"
import { EPISODE_ROW_LAYOUT, ROW_OVERFLOW, TV, tvSize } from "@/components/tv/tv-scale"
import { TVSectionHeader } from "@/components/tv/tv-section-header"
import * as React from "react"
import { FlatList, TVFocusGuideView, View } from "react-native"
import { TVEpisodeCard } from "./tv-episode-card"

export interface TVEpisodeShelfProps {
    title: string
    episodes: Anime_Episode[]
    onEpisodePress: (episode: Anime_Episode) => void
    first?: boolean
    cardProps?: (episode: Anime_Episode, index: number) => Omit<Partial<React.ComponentProps<typeof TVEpisodeCard>>, "onPress">
}

export const TVEpisodeShelf = React.memo(function TVEpisodeShelf({
    title,
    episodes,
    onEpisodePress,
    first,
    cardProps,
}: TVEpisodeShelfProps) {
    const renderItem = React.useCallback(({ item, index }: { item: Anime_Episode; index: number }) => {
        const extra = cardProps?.(item, index)
        return (
            <TVEpisodeCard
                image={item.episodeMetadata?.image}
                duration={item.episodeMetadata?.length}
                title={item.episodeTitle || `Episode ${item.episodeNumber}`}
                subtitle={item.displayTitle}
                preferred={first && index === 0}
                recyclingKey={item.localFile?.path || `tv-episode-${item.episodeNumber}-${index}`}
                {...extra}
                onPress={() => onEpisodePress(item)}
            />
        )
    }, [cardProps, first, onEpisodePress])

    if (episodes.length === 0) return null

    return (
        <View style={{ gap: tvSize(12) }}>
            <TVSectionHeader title={title} count={episodes.length} />
            <TVFocusGuideView trapFocusLeft trapFocusRight>
                <FlatList
                    horizontal
                    data={episodes}
                    renderItem={renderItem}
                    getItemLayout={EPISODE_ROW_LAYOUT}
                    keyExtractor={(item, index) => item.localFile?.path || `${item.type}-${item.episodeNumber}-${index}`}
                    snapToAlignment="item"
                    snapToItemPadding={TV.gutter}
                    style={[{ flexGrow: 0 }, ROW_OVERFLOW]}
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
