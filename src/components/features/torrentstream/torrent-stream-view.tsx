import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { useServerStatus } from "@/atoms/server.atoms"
import { EpisodeCardList } from "@/components/features/anime/episode-card-list"
import { AnimeEpisodeSection } from "@/components/features/media/anime-entry-library-view"
import { LabeledSwitch } from "@/components/shared/labeled-switch"
import { SegmentedControl } from "@/components/shared/segmented-control"
import { Surface } from "@/components/shared/surface"
import { getEpisodeSpoilerState, getSequentialContinueWatchingSpoilerActive } from "@/lib/anime-spoilers"
import * as React from "react"
import { Platform, Pressable, Text, TVFocusGuideView, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import type { StreamMode } from "./use-torrent-stream-controller"

import { TVEpisodeCard, TVEpisodeGrid, TVEpisodePlayButton, TVPillButton, tvSize } from "@/components/tv"

const TV_PAGE_SIZE = 24

type TorrentStreamViewProps = {
    entry: Anime_Entry,
    progress: number
    episodes: Anime_Episode[]
    selectedEpisodeNumber: number
    continueEpisodes: Anime_Episode[]
    availableModes: StreamMode[]
    onEpisodePress: (episode: Anime_Episode) => void
    isEpisodeSelectionLocked: boolean
    loadingEpisodeNumber: number | null
    autoSelect: boolean
    autoSelectFile: boolean
    streamMode: StreamMode
    onSelectStreamMode: (mode: StreamMode) => void
    onToggleAutoSelect: () => void
    onToggleAutoSelectFile: () => void
    onToggleUsePreviousBatch: () => void
    usePreviousBatch: boolean
    hasMappingError: boolean
    playRef?: React.Ref<React.ElementRef<typeof Pressable>>
    /** webOS: the episode whose stream the player left running; playing it resumes. */
    keptEpisodeNumber?: number | null
}

export function TorrentStreamView(props: TorrentStreamViewProps) {
    if (Platform.isTV) {
        return <TVTorrentStreamView {...props} />
    }

    return <MobileTorrentStreamView {...props} />
}

function TVTorrentStreamView({
    entry,
    progress,
    episodes,
    selectedEpisodeNumber,
    availableModes,
    onEpisodePress,
    isEpisodeSelectionLocked,
    loadingEpisodeNumber,
    autoSelect,
    autoSelectFile,
    streamMode,
    onSelectStreamMode,
    onToggleAutoSelect,
    onToggleAutoSelectFile,
    onToggleUsePreviousBatch,
    usePreviousBatch,
    hasMappingError,
    playRef,
    keptEpisodeNumber,
}: TorrentStreamViewProps) {
    const serverStatus = useServerStatus()
    const handleAvailableEpisodePress = React.useMemo(() => {
        return isEpisodeSelectionLocked ? undefined : onEpisodePress
    }, [isEpisodeSelectionLocked, onEpisodePress])

    const nextEpisode = React.useMemo(
        () => episodes.find(ep => ep.progressNumber > progress),
        [episodes, progress],
    )
    const playEpisode = nextEpisode ?? episodes[0]
    const pageEpisode = selectedEpisodeNumber
        || nextEpisode?.episodeNumber
        || episodes[0]?.episodeNumber
        || 0

    const initialPage = React.useMemo(() => {
        const idx = episodes.findIndex(ep => ep.episodeNumber === pageEpisode)
        return Math.floor(Math.max(0, idx) / TV_PAGE_SIZE)
    }, [episodes, pageEpisode])

    const renderEpisodeItem = React.useCallback((ep: Anime_Episode, idx: number) => {
        const isWatched = ep.progressNumber <= progress
        const isNext = ep.episodeNumber === nextEpisode?.episodeNumber
        const isLoading = ep.episodeNumber === loadingEpisodeNumber
        const isKept = ep.episodeNumber === keptEpisodeNumber
        const spoiler = getEpisodeSpoilerState(serverStatus, {
            episodeNumber: ep.progressNumber || ep.episodeNumber,
            watchedProgress: progress,
        })
        return (
            <TVEpisodeCard
                key={ep.episodeNumber}
                image={ep.episodeMetadata?.image || entry.media?.bannerImage}
                duration={ep.episodeMetadata?.length}
                badge={isLoading ? "Preparing…" : isKept ? "Resume" : (isNext ? "Up next" : undefined)}
                title={spoiler.hideTitle ? `Episode ${ep.episodeNumber}` : ep.episodeTitle || `Episode ${ep.episodeNumber}`}
                subtitle={spoiler.hideTitle ? undefined : ep.displayTitle}
                completed={isWatched}
                blurred={spoiler.hideThumbnail}
                disabled={isEpisodeSelectionLocked}
                onPress={() => handleAvailableEpisodePress?.(ep)}
                recyclingKey={ep.localFile?.path || `tv-torrent-ep-${ep.episodeNumber}-${idx}`}
            />
        )
    }, [
        handleAvailableEpisodePress,
        isEpisodeSelectionLocked,
        keptEpisodeNumber,
        loadingEpisodeNumber,
        nextEpisode?.episodeNumber,
        progress,
        entry.media?.bannerImage,
        serverStatus,
    ])

    const controls = (
        <TVFocusGuideView
            trapFocusRight
            style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: tvSize(10),
            }}
        >
            {availableModes.length > 1 ? (
                <TVPillButton
                    label={streamMode === "debrid" ? "Debrid streaming" : "Torrent streaming"}
                    active
                    icon={<Ionicons name="swap-horizontal" size={tvSize(22)} color="#b8b0ff" />}
                    onPress={() => onSelectStreamMode(streamMode === "debrid" ? "torrent" : "debrid")}
                />
            ) : null}

            <TVPillButton
                label={"Auto-select torrent"}
                active={autoSelect}
                onPress={onToggleAutoSelect}
            />

            {!autoSelect && usePreviousBatch ? (
                <TVPillButton
                    label="Reuse previous batch"
                    active
                    onPress={onToggleUsePreviousBatch}
                />
            ) : null}

            {!autoSelect && !usePreviousBatch ? (
                <TVPillButton
                    label="Auto-select file"
                    active={autoSelectFile}
                    onPress={onToggleAutoSelectFile}
                />
            ) : null}

            {hasMappingError ? (
                <Text className="text-yellow-200" style={{ fontSize: tvSize(16) }}>
                    AniDB mapping missing
                </Text>
            ) : null}
        </TVFocusGuideView>
    )

    return (
        <View style={{ paddingBottom: tvSize(80) }}>
            <TVEpisodeGrid
                title="Episodes"
                episodes={episodes}
                pageSize={TV_PAGE_SIZE}
                initialPage={initialPage}
                after={playEpisode ? (
                    <TVEpisodePlayButton
                        ref={playRef}
                        episode={playEpisode.episodeNumber}
                        disabled={isEpisodeSelectionLocked}
                        onPress={() => handleAvailableEpisodePress?.(playEpisode)}
                    />
                ) : null}
                action={controls}
                renderItem={renderEpisodeItem}
            />
        </View>
    )
}

function MobileTorrentStreamView({
    entry,
    progress,
    episodes,
    selectedEpisodeNumber,
    continueEpisodes,
    availableModes,
    onEpisodePress,
    isEpisodeSelectionLocked,
    loadingEpisodeNumber,
    autoSelect,
    autoSelectFile,
    streamMode,
    onSelectStreamMode,
    onToggleAutoSelect,
    onToggleAutoSelectFile,
    onToggleUsePreviousBatch,
    usePreviousBatch,
    hasMappingError,
}: TorrentStreamViewProps) {
    const serverStatus = useServerStatus()
    const continueWatchingSpoilerActive = getSequentialContinueWatchingSpoilerActive(serverStatus)

    const initialActiveEpisodeNumber = React.useMemo(() => {
        if (selectedEpisodeNumber > 0) return selectedEpisodeNumber
        const nextUp = episodes.find(ep => ep.episodeNumber > progress)
        return nextUp?.episodeNumber ?? episodes[0]?.episodeNumber ?? 0
    }, [selectedEpisodeNumber, episodes, progress])
    const handleAvailableEpisodePress = React.useMemo(() => {
        return isEpisodeSelectionLocked ? undefined : onEpisodePress
    }, [isEpisodeSelectionLocked, onEpisodePress])

    return (
        <>
            <View className="px-4 mb-5">
                <Surface variant="muted" className="p-3.5 gap-3.5">
                    {availableModes.length > 1 && (
                        <SegmentedControl
                            options={[
                                { value: "torrent", label: "Torrent" },
                                { value: "debrid", label: "Debrid" },
                            ]}
                            value={streamMode}
                            onChange={onSelectStreamMode}
                        />
                    )}

                    {hasMappingError && (
                        <Text className="text-yellow-200 text-xs leading-relaxed">
                            AniDB mapping is missing for this title. Manual release selection may be required.
                        </Text>
                    )}

                    <LabeledSwitch
                        label={streamMode === "debrid" ? "Auto-select debrid stream" : "Auto-select torrent"}
                        checked={autoSelect}
                        onToggle={onToggleAutoSelect}
                        helper={streamMode === "debrid"
                            ? "Automatically pick the best torrent and debrid file for the episode."
                            : "Automatically pick the best torrent and file for the episode."}
                    />

                    {!autoSelect && usePreviousBatch && (
                        <LabeledSwitch
                            label="Reuse previous batch"
                            checked={usePreviousBatch}
                            onToggle={onToggleUsePreviousBatch}
                            helper="Reuse the previously selected batch torrent for subsequent episodes when possible."
                        />
                    )}

                    {!autoSelect && !usePreviousBatch && (
                        <LabeledSwitch
                            label="Auto-select file"
                            checked={autoSelectFile}
                            onToggle={onToggleAutoSelectFile}
                            helper={"Automatically select the matching file from batch torrents."}
                        />
                    )}
                </Surface>
            </View>

            {continueEpisodes.length > 0 && (
                <View className="mb-6">
                    <EpisodeCardList
                        title="Continue Watching"
                        episodes={continueEpisodes}
                        onEpisodePress={handleAvailableEpisodePress}
                        watchedProgress={progress}
                        spoilerActive={continueWatchingSpoilerActive}
                        disabled={isEpisodeSelectionLocked}
                        loadingEpisodeNumber={loadingEpisodeNumber}
                    />
                </View>
            )}

            <View className="px-4 gap-6">
                <AnimeEpisodeSection
                    title={`Episodes`}
                    episodes={episodes}
                    progress={progress}
                    entry={entry}
                    onEpisodePress={handleAvailableEpisodePress}
                    initialActiveEpisodeNumber={initialActiveEpisodeNumber}
                    disableEpisodePresses={isEpisodeSelectionLocked}
                    loadingEpisodeNumber={loadingEpisodeNumber}
                />
            </View>
        </>
    )
}
