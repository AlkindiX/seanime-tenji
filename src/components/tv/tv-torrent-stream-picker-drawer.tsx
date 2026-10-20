import {
    Anime_Episode,
    Debrid_TorrentItemInstantAvailability,
    DebridClient_FilePreview,
    ExtensionRepo_AnimeTorrentProviderExtensionItem,
    Habari_Metadata,
    HibikeTorrent_AnimeProviderSmartSearchFilter,
    HibikeTorrent_AnimeTorrent,
    Torrentstream_FilePreview,
} from "@/api/generated/types"
import { releaseAudioProblem } from "@/components/features/torrentstream/release-audio"
import { getFileSelectionValue, isSameTorrent } from "@/components/features/torrentstream/torrent-stream-picker-utils"
import {
    TORRENT_RESOLUTIONS,
    TorrentResolution,
    TorrentSearchMode,
    TorrentSheetStage,
} from "@/components/features/torrentstream/use-torrent-stream-controller"
import type { StreamMode } from "@/components/features/torrentstream/use-torrent-stream-controller"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import { TVButton, TVDrawer, TVInput, TVPillButton, useTVFocus } from "@/components/tv"
import type { TVInputHandle } from "@/components/tv/tv-input"
import { ROW_OVERFLOW, tvSize } from "@/components/tv/tv-scale"
import { Ionicons } from "@expo/vector-icons"
import * as React from "react"
import { Animated, FlatList, Platform, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

type TVTorrentStreamPickerDrawerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pickerStage: TorrentSheetStage;
    torrents: HibikeTorrent_AnimeTorrent[];
    filePreviews?: Array<Torrentstream_FilePreview | DebridClient_FilePreview>;
    isLoadingFilePreviews: boolean;
    isSearching: boolean;
    isStarting: boolean;
    onSelectTorrent: (torrent: HibikeTorrent_AnimeTorrent | null) => void;
    onSelectFileId: (fileId: string) => void;
    onConfirmFileSelection: () => void;
    onConfirmTorrentSelection: () => void;
    onBackToTorrentList: () => void;
    selectedEpisode: Anime_Episode | null;
    episodes: Anime_Episode[];
    selectedTorrent: HibikeTorrent_AnimeTorrent | null;
    selectedFileId: string | null;
    streamMode: StreamMode;

    // Parity features from phone
    bestRelease: boolean;
    searchAcrossProviders: boolean;
    resolution: TorrentResolution;
    searchMode: TorrentSearchMode;
    onToggleBestRelease: () => void;
    onToggleSearchAcrossProviders: () => void;
    onSelectResolution: (res: TorrentResolution) => void;
    onSelectSearchMode: (mode: TorrentSearchMode) => void;
    torrentCache?: Record<string, Debrid_TorrentItemInstantAvailability>;
    torrentMetadataByInfoHash?: Record<string, Habari_Metadata | undefined>;

    // Provider list and text search
    providerExtensions: ExtensionRepo_AnimeTorrentProviderExtensionItem[];
    selectedProviderId: string;
    onSelectProvider: (providerId: string) => void;
    supportsSmartSearch: boolean;
    smartSearchFilters: HibikeTorrent_AnimeProviderSmartSearchFilter[];
    smartSearchBatch: boolean;
    onToggleSmartBatch: () => void;
    extraProviderIds: string[];
    onSelectExtraProviderIds: (ids: string[]) => void;
    onSelectStage: (stage: TorrentSheetStage) => void;
    searchQuery: string;
    onUpdateSearchQuery: (query: string) => void;
    onRefetchSearch: () => void;
};

const DRAWER_WIDTH = tvSize(650);

function _cleanTorrentHash(hash?: string | null): string {
    if (!hash) return "";
    return hash.trim().toLowerCase();
}

function makeCacheSet(cache?: Record<string, unknown>): Set<string> {
    const hashes = Object.keys(cache ?? {})
        .map(_cleanTorrentHash)
        .filter(Boolean);
    return new Set(hashes);
}

function isTorrentCached(
    hash: string | null | undefined,
    cache: ReadonlySet<string>,
): boolean {
    const cleanHash = _cleanTorrentHash(hash);
    return cleanHash.length > 0 && cache.has(cleanHash);
}

function uniqueInts(arr?: (number | string | null)[]): number[] {
    if (!arr) return [];
    const ints = arr
        .map((x) =>
            typeof x === "number" ? x : Number.parseInt(String(x), 10),
        )
        .filter((x) => !Number.isNaN(x));
    return Array.from(new Set(ints)).sort((a, b) => a - b);
}

function normalizeEpisodeNumber(
    episodeNumber: number,
    episodes: Anime_Episode[],
) {
    const matchingEpisode = episodes.find(
        (episode) => episode.absoluteEpisodeNumber === episodeNumber,
    );
    return matchingEpisode?.episodeNumber ?? episodeNumber;
}

function getTorrentCardTitle(
    torrent: HibikeTorrent_AnimeTorrent,
    metadata: Habari_Metadata | undefined,
    episodes: Anime_Episode[],
) {
    const episodeNumbers = metadata?.episode_number;

    if (!torrent.isBatch) {
        if (episodeNumbers?.length === 1) {
            const parsedEpisodeNumber = Number.parseInt(episodeNumbers[0], 10);
            return `Episode ${normalizeEpisodeNumber(parsedEpisodeNumber, episodes)}`;
        }
        if (episodeNumbers?.length === 0) return "Batch";
        if (metadata?.formatted_title) return metadata.formatted_title;
        return `Episode ${torrent.episodeNumber || ""}`;
    }

    const partNumbers = uniqueInts(metadata?.part_number);
    if (partNumbers.length > 1) {
        const first = partNumbers[0];
        const last = partNumbers[partNumbers.length - 1];
        if (first !== last) {
            return partNumbers.length === 2 && last - first === 1
                ? `Part ${first} and ${last}`
                : `Parts ${first} to ${last}`;
        }
        return `Part ${first}`;
    }

    const seasonNumbers = uniqueInts(metadata?.season_number);
    if (seasonNumbers.length > 1) {
        const first = seasonNumbers[0];
        const last = seasonNumbers[seasonNumbers.length - 1];
        if (first !== last) {
            return seasonNumbers.length === 2 && last - first === 1
                ? `Season ${first} and ${last}`
                : `Seasons ${first} to ${last}`;
        }
        return `Season ${first}`;
    }

    const batchEpisodeNumbers = uniqueInts(metadata?.episode_number);
    if (batchEpisodeNumbers.length > 1) {
        let title = `Episodes ${batchEpisodeNumbers[0]} to ${batchEpisodeNumbers[batchEpisodeNumbers.length - 1]}`;
        if (seasonNumbers.length === 1) {
            title += ` (Season ${seasonNumbers[0]})`;
        }
        return title;
    }

    if (seasonNumbers.length === 1) return `Season ${seasonNumbers[0]}`;
    return "Batch";
}

function formatProviderName(provider: string) {
    return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function TVTorrentStreamPickerDrawer({
    open,
    onOpenChange,
    pickerStage,
    torrents,
    filePreviews,
    isLoadingFilePreviews,
    isSearching,
    isStarting,
    onSelectTorrent,
    onSelectFileId,
    onConfirmFileSelection,
    onConfirmTorrentSelection,
    onBackToTorrentList,
    selectedEpisode,
    episodes,
    selectedTorrent,
    selectedFileId,
    streamMode,
    bestRelease,
    searchAcrossProviders,
    resolution,
    searchMode,
    onToggleBestRelease,
    onToggleSearchAcrossProviders,
    onSelectResolution,
    onSelectSearchMode,
    torrentCache,
    torrentMetadataByInfoHash,
    providerExtensions,
    selectedProviderId,
    onSelectProvider,
    supportsSmartSearch,
    smartSearchFilters,
    smartSearchBatch,
    onToggleSmartBatch,
    extraProviderIds,
    onSelectExtraProviderIds,
    onSelectStage,
    searchQuery,
    onUpdateSearchQuery,
    onRefetchSearch,
}: TVTorrentStreamPickerDrawerProps) {
    const [localQuery, setLocalQuery] = React.useState(searchQuery);
    const inputRef = React.useRef<TVInputHandle>(null);
    const drawerShown = React.useRef(false);

    React.useEffect(() => {
        setLocalQuery(searchQuery);
    }, [searchQuery, open]);

    const focusInput = React.useCallback(() => {
        requestAnimationFrame(() => {
            inputRef.current?.requestTVFocus();
        });
    }, []);

    React.useEffect(() => {
        if (!open) {
            drawerShown.current = false;
            return;
        }
        if (drawerShown.current && pickerStage === "torrents") {
            focusInput();
        }
    }, [focusInput, open, pickerStage]);

    const handleDrawerShow = React.useCallback(() => {
        drawerShown.current = true;
        if (pickerStage === "torrents") {
            focusInput();
        }
    }, [focusInput, pickerStage]);

    const handleSearchSubmit = React.useCallback(() => {
        if (localQuery.trim()) {
            onSelectSearchMode("simple");
        } else {
            onSelectSearchMode("smart");
        }

        if (localQuery === searchQuery) {
            onRefetchSearch();
        } else {
            onUpdateSearchQuery(localQuery);
        }
    }, [
        localQuery,
        searchQuery,
        onUpdateSearchQuery,
        onSelectSearchMode,
        onRefetchSearch,
    ]);

    const cacheSet = React.useMemo(
        () => makeCacheSet(torrentCache),
        [torrentCache],
    );

    const extraProviders = React.useMemo(
        () => providerExtensions.filter((provider) => provider.id !== selectedProviderId),
        [providerExtensions, selectedProviderId],
    );

    const activeExtraProviderIds = React.useMemo(() => {
        const validIds = new Set(extraProviders.map((provider) => provider.id));
        return extraProviderIds.filter((id) => validIds.has(id));
    }, [extraProviderIds, extraProviders]);

    const toggleExtra = React.useCallback((providerId: string) => {
        if (extraProviderIds.includes(providerId)) {
            onSelectExtraProviderIds(extraProviderIds.filter((id) => id !== providerId));
            return;
        }

        onSelectExtraProviderIds([...extraProviderIds, providerId]);
    }, [extraProviderIds, onSelectExtraProviderIds]);

    const toggleAcross = React.useCallback(() => {
        const enabling = !searchAcrossProviders;
        onToggleSearchAcrossProviders();

        if (enabling && activeExtraProviderIds.length === 0) {
            onSelectStage("providers");
        }
    }, [
        activeExtraProviderIds.length,
        onSelectStage,
        onToggleSearchAcrossProviders,
        searchAcrossProviders,
    ]);

    const primaryLabel = React.useMemo(() => {
        if (isStarting) return "Starting...";
        if (pickerStage === "files") return "Stream selected file";
        if (!selectedTorrent) {
            return "Auto select now";
        }
        if (selectedTorrent.isBatch) return "Choose file";
        return "Start selected";
    }, [isStarting, pickerStage, selectedTorrent, streamMode]);

    const previews = React.useMemo(
        () => [...(filePreviews ?? [])].sort(
            (first, second) => Number(second.isLikely) - Number(first.isLikely),
        ),
        [filePreviews],
    );

    const selectTorrent = React.useCallback((torrent: HibikeTorrent_AnimeTorrent) => {
        if (isSameTorrent(selectedTorrent, torrent)) {
            onConfirmTorrentSelection();
        } else {
            onSelectTorrent(torrent);
        }
    }, [onSelectTorrent, selectedTorrent, onConfirmTorrentSelection]);

    const subtitle = pickerStage === "files"
        ? "Select File"
        : pickerStage === "providers"
          ? "Additional Providers"
          : "Select Release";

    return (
        <TVDrawer
            open={open}
            onOpenChange={onOpenChange}
            onShow={handleDrawerShow}
            title={`Episode ${selectedEpisode?.episodeNumber || ""}`}
            subtitle={subtitle}
            width={DRAWER_WIDTH}
        >
            {pickerStage === "torrents" && !isStarting && (
                <View
                    style={{
                        gap: tvSize(14),
                        borderBottomWidth: tvSize(1),
                        borderBottomColor: "rgba(255,255,255,0.06)",
                        paddingBottom: tvSize(16),
                        paddingHorizontal: tvSize(30),
                    }}
                >
                    <View style={{ gap: tvSize(6) }}>
                        <Text
                            style={{
                                fontSize: tvSize(14),
                                color: "rgba(255,255,255,0.4)",
                                fontWeight: "600",
                            }}
                        >
                            SEARCH QUERY
                        </Text>
                        <View
                            style={{
                                flexDirection: "row",
                                gap: tvSize(10),
                                alignItems: "center",
                            }}
                        >
                            <TVInput
                                ref={inputRef}
                                value={localQuery}
                                onChangeText={setLocalQuery}
                                onSubmitEditing={handleSearchSubmit}
                                placeholder="Search release..."
                                placeholderTextColor="rgba(255,255,255,0.3)"
                            />
                            <TVButton
                                label="Search"
                                size="compact"
                                icon={
                                    <Ionicons
                                        name="search"
                                        size={tvSize(20)}
                                        color="white"
                                    />
                                }
                                onPress={handleSearchSubmit}
                                disabled={isSearching}
                            />
                        </View>
                    </View>

                    {providerExtensions.length > 0 && (
                        <View style={{ gap: tvSize(6) }}>
                            <Text
                                style={{
                                    fontSize: tvSize(14),
                                    color: "rgba(255,255,255,0.4)",
                                    fontWeight: "600",
                                }}
                            >
                                PROVIDER
                            </Text>
                            <TVFocusGuideView trapFocusLeft trapFocusRight>
                                <FlatList
                                    horizontal
                                    data={providerExtensions}
                                    keyExtractor={(
                                        p: ExtensionRepo_AnimeTorrentProviderExtensionItem,
                                    ) => p.id}
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={{
                                        gap: tvSize(10),
                                        paddingVertical: tvSize(8),
                                    }}
                                    style={ROW_OVERFLOW}
                                    renderItem={({
                                        item: p,
                                    }: {
                                        item: ExtensionRepo_AnimeTorrentProviderExtensionItem;
                                    }) => (
                                        <TVPillButton
                                            label={p.name}
                                            active={selectedProviderId === p.id}
                                            onPress={() =>
                                                onSelectProvider(p.id)
                                            }
                                            style={{ flexShrink: 0 }}
                                        />
                                    )}
                                />
                            </TVFocusGuideView>
                        </View>
                    )}

                    <TVFocusGuideView
                        autoFocus
                        trapFocusLeft
                        trapFocusRight
                        style={{
                            flexDirection: "row",
                            gap: tvSize(10),
                            flexWrap: "wrap",
                        }}
                    >
                        {supportsSmartSearch && (
                            <TVPillButton
                                label="Smart search"
                                active={searchMode === "smart"}
                                onPress={() =>
                                    onSelectSearchMode(
                                        searchMode === "smart" ? "simple" : "smart",
                                    )
                                }
                            />
                        )}
                        {supportsSmartSearch
                            && searchMode === "smart"
                            && smartSearchFilters.includes("batch") && (
                            <TVPillButton
                                label="Search batches"
                                active={smartSearchBatch}
                                onPress={onToggleSmartBatch}
                            />
                        )}
                        {supportsSmartSearch
                            && searchMode === "smart"
                            && smartSearchFilters.includes("bestReleases") && (
                            <TVPillButton
                                label="Best releases"
                                active={bestRelease}
                                onPress={onToggleBestRelease}
                            />
                        )}
                        {extraProviders.length > 0 && (
                            <TVPillButton
                                label="Search across providers"
                                active={searchAcrossProviders}
                                onPress={toggleAcross}
                            />
                        )}
                        {searchAcrossProviders && extraProviders.length > 0 && (
                            <TVPillButton
                                label={activeExtraProviderIds.length > 0
                                    ? `${activeExtraProviderIds.length} extra provider${activeExtraProviderIds.length === 1 ? "" : "s"}`
                                    : "Choose providers"}
                                active={activeExtraProviderIds.length > 0}
                                onPress={() => onSelectStage("providers")}
                            />
                        )}
                    </TVFocusGuideView>

                    {supportsSmartSearch
                        && searchMode === "smart"
                        && smartSearchFilters.includes("resolution") && (
                        <TVFocusGuideView
                            autoFocus
                            trapFocusLeft
                            trapFocusRight
                            style={{
                                flexDirection: "row",
                                gap: tvSize(10),
                                flexWrap: "wrap",
                                alignItems: "center",
                            }}
                        >
                            <TVPillButton
                                label="ANY"
                                active={!resolution}
                                onPress={() => onSelectResolution(undefined)}
                            />
                            {TORRENT_RESOLUTIONS.map((res) => (
                                <TVPillButton
                                    key={res}
                                    label={`${res}P`}
                                    active={resolution === res}
                                    onPress={() => onSelectResolution(res)}
                                />
                            ))}
                        </TVFocusGuideView>
                    )}

                    <TVButton
                        label={primaryLabel}
                        variant="primary"
                        icon={
                            <Ionicons
                                name={selectedTorrent?.isBatch ? "arrow-forward" : "play"}
                                size={tvSize(20)}
                                color="white"
                            />
                        }
                        onPress={onConfirmTorrentSelection}
                        disabled={
                            isSearching
                            || isStarting
                            || !selectedEpisode
                        }
                    />
                </View>
            )}

            {isStarting ? (
                <View
                    style={{
                        flex: 1,
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                >
                    <CenteredSpinner />
                </View>
            ) : pickerStage === "providers" ? (
                <View style={{ flex: 1, gap: tvSize(16) }}>
                        <TVFocusGuideView
                        autoFocus
                        trapFocusLeft
                        trapFocusRight
                        style={{
                            flexDirection: "row",
                            gap: tvSize(10),
                            alignItems: "center",
                            paddingHorizontal: tvSize(30),
                            paddingVertical: tvSize(8),
                        }}
                    >
                        <TVButton
                            label="Back to Releases"
                            variant="secondary"
                            size="compact"
                            preferred
                            icon={
                                <Ionicons
                                    name="arrow-back"
                                    size={tvSize(18)}
                                    color="white"
                                />
                            }
                            onPress={onBackToTorrentList}
                        />
                        <TVButton
                            label="Select All"
                            variant="secondary"
                            size="compact"
                            onPress={() =>
                                onSelectExtraProviderIds(
                                    extraProviders.map((provider) => provider.id),
                                )
                            }
                            disabled={extraProviders.length === 0}
                        />
                        <TVButton
                            label="Clear"
                            variant="ghost"
                            size="compact"
                            onPress={() => onSelectExtraProviderIds([])}
                            disabled={activeExtraProviderIds.length === 0}
                        />
                    </TVFocusGuideView>

                    <Text
                        style={{
                            paddingHorizontal: tvSize(30),
                            fontSize: tvSize(14),
                            color: "rgba(255,255,255,0.4)",
                        }}
                    >
                        {activeExtraProviderIds.length === 0
                            ? "Choose at least one additional provider."
                            : `${activeExtraProviderIds.length} additional provider${activeExtraProviderIds.length === 1 ? "" : "s"} selected.`}
                    </Text>

                    {extraProviders.length > 0 ? (
                        <ScrollView
                            contentContainerStyle={{
                                gap: tvSize(14),
                                paddingHorizontal: tvSize(30),
                                paddingVertical: tvSize(8),
                                paddingBottom: tvSize(40),
                            }}
                            style={{ flex: 1 }}
                            showsVerticalScrollIndicator={false}
                        >
                            {extraProviders.map((provider) => (
                                <TVFileCard
                                    key={provider.id}
                                    id={provider.id}
                                    name={provider.name}
                                    detail={provider.lang?.toUpperCase() ?? ""}
                                    isSelected={extraProviderIds.includes(provider.id)}
                                    onSelect={toggleExtra}
                                />
                            ))}
                        </ScrollView>
                    ) : (
                        <Text
                            className="text-white/40 text-center py-20"
                            style={{ fontSize: tvSize(18) }}
                        >
                            No additional providers installed.
                        </Text>
                    )}
                </View>
            ) : pickerStage === "files" ? (
                <View style={{ flex: 1, gap: tvSize(16) }}>
                    <View
                        style={{
                            flexDirection: "row",
                            gap: tvSize(10),
                            alignItems: "center",
                            paddingHorizontal: tvSize(30),
                        }}
                    >
                        <TVButton
                            label="Back to Releases"
                            variant="secondary"
                            size="compact"
                            preferred
                            icon={
                                <Ionicons
                                    name="arrow-back"
                                    size={tvSize(18)}
                                    color="white"
                                />
                            }
                            onPress={onBackToTorrentList}
                        />
                        <TVButton
                            label="Stream selected file"
                            variant="primary"
                            size="compact"
                            icon={
                                <Ionicons
                                    name="play"
                                    size={tvSize(18)}
                                    color="white"
                                />
                            }
                            onPress={onConfirmFileSelection}
                            disabled={selectedFileId === null}
                        />
                    </View>

                    {isLoadingFilePreviews ? (
                        <CenteredSpinner />
                    ) : previews.length > 0 ? (
                        <ScrollView
                            contentContainerStyle={{
                                gap: tvSize(14),
                                paddingHorizontal: tvSize(30),
                                paddingBottom: tvSize(40),
                            }}
                            style={{ flex: 1 }}
                            showsVerticalScrollIndicator={false}
                        >
                            {previews.map((file) => {
                                const fileId = getFileSelectionValue(file);

                                return (
                                    <TVFileCard
                                        key={fileId}
                                        id={fileId}
                                        name={file.displayTitle || file.displayPath}
                                        detail={file.displayPath}
                                        isLikely={file.isLikely}
                                        isSelected={selectedFileId === fileId}
                                        onSelect={(id) => {
                                            if (selectedFileId === id) {
                                                onConfirmFileSelection();
                                            } else {
                                                onSelectFileId(id);
                                            }
                                        }}
                                    />
                                );
                            })}
                        </ScrollView>
                    ) : (
                        <Text
                            className="text-white/40 text-center py-20"
                            style={{ fontSize: tvSize(18) }}
                        >
                            No files found inside this release.
                        </Text>
                    )}
                </View>
            ) : (
                <View style={{ flex: 1 }}>
                    {isSearching ? (
                        <View
                            style={{
                                flex: 1,
                                justifyContent: "center",
                                alignItems: "center",
                            }}
                        >
                            <CenteredSpinner />
                        </View>
                    ) : torrents.length > 0 ? (
                        <ScrollView
                            contentContainerStyle={{
                                gap: tvSize(16),
                                paddingHorizontal: tvSize(30),
                                paddingBottom: tvSize(40),
                                paddingVertical: tvSize(8),
                            }}
                            style={{ flex: 1 }}
                            showsVerticalScrollIndicator={false}
                        >
                            {torrents.map((torrent, index) => (
                                <TVTorrentCard
                                    key={String(
                                        torrent.infoHash
                                        || torrent.downloadUrl
                                        || index,
                                    )}
                                    torrent={torrent}
                                    episodes={episodes}
                                    metadata={torrent.infoHash
                                        ? torrentMetadataByInfoHash?.[torrent.infoHash]
                                        : undefined}
                                    isCached={isTorrentCached(torrent.infoHash, cacheSet)}
                                    isSelected={isSameTorrent(selectedTorrent, torrent)}
                                    onSelect={selectTorrent}
                                />
                            ))}
                        </ScrollView>
                    ) : (
                        <Text
                            className="text-white/40 text-center py-20"
                            style={{ fontSize: tvSize(18) }}
                        >
                            No releases found for this episode.
                        </Text>
                    )}
                </View>
            )}

        </TVDrawer>
    );
}

type TVTorrentCardProps = {
    torrent: HibikeTorrent_AnimeTorrent;
    episodes: Anime_Episode[];
    metadata?: Habari_Metadata;
    isCached?: boolean;
    isSelected: boolean;
    onSelect: (torrent: HibikeTorrent_AnimeTorrent) => void;
};

const TVTorrentCard = React.memo(function TVTorrentCard({
    torrent,
    episodes,
    metadata,
    isCached,
    isSelected,
    onSelect,
}: TVTorrentCardProps) {
    const focus = useTVFocus(1.02);

    const cardTitle = React.useMemo(() => {
        return getTorrentCardTitle(torrent, metadata, episodes);
    }, [episodes, metadata, torrent]);

    const handlePress = React.useCallback(() => {
        onSelect(torrent);
    }, [onSelect, torrent]);

    // webOS: LG TVs may not play FLAC in a video, and the server can't transcode a stream.
    const audioProblem = Platform.OS === "web" ? releaseAudioProblem(torrent.name, metadata) : null;

    const displayReleaseGroup = torrent.releaseGroup || "";
    const displayResolution = torrent.resolution || "";

    const seederInfo = React.useMemo(() => {
        const seeders = torrent.seeders ?? 0;
        if (seeders >= 50)
            return { color: "#a5b4fc", iconName: "battery-full" as const };
        if (seeders >= 20)
            return { color: "#86efac", iconName: "battery-full" as const };
        if (seeders >= 10)
            return { color: "#86efac", iconName: "battery-half" as const };
        if (seeders >= 5)
            return { color: "#fdba74", iconName: "battery-half" as const };
        return { color: "#fca5a5", iconName: "battery-dead" as const };
    }, [torrent.seeders]);

    return (
        <Pressable
            onPress={handlePress}
            onFocus={focus.focus}
            onBlur={focus.blur}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
        >
            <Animated.View
                style={[
                    focus.style,
                    {
                        padding: tvSize(16),
                        borderRadius: tvSize(12),
                        backgroundColor: focus.focused
                            ? "rgba(255,255,255,0.08)"
                            : isSelected
                              ? "rgba(168,159,255,0.12)"
                              : "rgba(255,255,255,0.04)",
                        borderWidth: tvSize(2),
                        borderColor: focus.focused
                            ? "#ffffff"
                            : isSelected
                              ? "#9b90ff"
                              : "rgba(255,255,255,0.08)",
                        gap: tvSize(10),
                    },
                ]}
            >
                <View
                    style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: tvSize(6),
                            flexShrink: 1,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: tvSize(18),
                                fontWeight: "bold",
                                color: "#ffffff",
                            }}
                            numberOfLines={1}
                        >
                            {cardTitle}
                        </Text>
                        {torrent.confirmed && (
                            <Ionicons
                                name="checkmark-circle"
                                size={tvSize(16)}
                                color={
                                    torrent.isBestRelease
                                        ? "#f472b6"
                                        : "rgba(255,255,255,0.28)"
                                }
                            />
                        )}
                        {isSelected && (
                            <Ionicons
                                name="checkmark-circle"
                                size={tvSize(18)}
                                color="#b8b0ff"
                            />
                        )}
                    </View>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: tvSize(8),
                        }}
                    >
                        {!!displayReleaseGroup && (
                            <Text
                                style={{
                                    fontSize: tvSize(14),
                                    fontWeight: "600",
                                    color: "rgba(255,255,255,0.6)",
                                }}
                            >
                                {displayReleaseGroup}
                            </Text>
                        )}
                        {!!displayResolution && (
                            <View
                                style={{
                                    backgroundColor: "rgba(255,255,255,0.1)",
                                    paddingHorizontal: tvSize(6),
                                    paddingVertical: tvSize(2),
                                    borderRadius: tvSize(4),
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: tvSize(12),
                                        fontWeight: "bold",
                                        color: "#ffffff",
                                    }}
                                >
                                    {displayResolution}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                <Text
                    style={{
                        fontSize: tvSize(14),
                        color: "rgba(255,255,255,0.4)",
                        lineHeight: tvSize(18),
                    }}
                    numberOfLines={2}
                >
                    {torrent.name}
                </Text>

                <View
                    style={{
                        flexDirection: "row",
                        gap: tvSize(12),
                        flexWrap: "wrap",
                        alignItems: "center",
                    }}
                >
                    {torrent.isBestRelease && (
                        <View
                            style={{
                                backgroundColor: "rgba(131,24,67,0.72)",
                                paddingHorizontal: tvSize(8),
                                paddingVertical: tvSize(2),
                                borderRadius: tvSize(6),
                                flexDirection: "row",
                                alignItems: "center",
                                gap: tvSize(4),
                            }}
                        >
                            <Ionicons
                                name="diamond"
                                size={tvSize(11)}
                                color="#fbcfe8"
                            />
                            <Text
                                style={{
                                    fontSize: tvSize(12),
                                    fontWeight: "bold",
                                    color: "#fbcfe8",
                                }}
                            >
                                Highest quality
                            </Text>
                        </View>
                    )}

                    {audioProblem && (
                        <View
                            accessible
                            accessibilityLabel={`${audioProblem} audio, may not play on this TV`}
                            style={{
                                backgroundColor: "rgba(146,64,14,0.72)",
                                paddingHorizontal: tvSize(8),
                                paddingVertical: tvSize(2),
                                borderRadius: tvSize(6),
                                flexDirection: "row",
                                alignItems: "center",
                                gap: tvSize(4),
                            }}
                        >
                            <Ionicons
                                name="warning"
                                size={tvSize(11)}
                                color="#fde68a"
                            />
                            <Text
                                style={{
                                    fontSize: tvSize(12),
                                    fontWeight: "bold",
                                    color: "#fde68a",
                                }}
                            >
                                {audioProblem}
                            </Text>
                        </View>
                    )}

                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: tvSize(4),
                        }}
                    >
                        <Ionicons
                            name={seederInfo.iconName}
                            size={tvSize(14)}
                            color={seederInfo.color}
                        />
                        <Text
                            style={{
                                fontSize: tvSize(14),
                                fontWeight: "bold",
                                color: seederInfo.color,
                            }}
                        >
                            {torrent.seeders || 0}
                        </Text>
                        <Text
                            style={{
                                fontSize: tvSize(14),
                                color: "rgba(255,255,255,0.4)",
                            }}
                        >
                            seeder{torrent.seeders === 1 ? "" : "s"}
                        </Text>
                    </View>

                    <Text
                        style={{
                            fontSize: tvSize(14),
                            fontWeight: "600",
                            color: "rgba(255,255,255,0.5)",
                        }}
                    >
                        {torrent.formattedSize}
                    </Text>

                    {!!torrent.provider && (
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: tvSize(4),
                            }}
                        >
                            <Ionicons
                                name="server-outline"
                                size={tvSize(12)}
                                color="rgba(255,255,255,0.3)"
                            />
                            <Text
                                style={{
                                    fontSize: tvSize(13),
                                    color: "rgba(255,255,255,0.3)",
                                }}
                            >
                                {formatProviderName(torrent.provider)}
                            </Text>
                        </View>
                    )}

                    {isCached && (
                        <View className="flex-row items-center gap-1.5">
                            <Ionicons name="speedometer" size={11} color="#a4f4cf" />
                            <Text className="text-[11px] font-medium text-emerald-200/70">Cached</Text>
                        </View>
                    )}
                </View>
            </Animated.View>
        </Pressable>
    );
});

type TVFileCardProps = {
    id: string;
    name: string;
    detail: string;
    isLikely?: boolean;
    isSelected: boolean;
    onSelect: (id: string) => void;
};

const TVFileCard = React.memo(function TVFileCard({
    id,
    name,
    detail,
    isLikely,
    isSelected,
    onSelect,
}: TVFileCardProps) {
    const focus = useTVFocus(1.02);
    const handlePress = React.useCallback(() => {
        onSelect(id);
    }, [id, onSelect]);

    return (
        <Pressable
            onPress={handlePress}
            onFocus={focus.focus}
            onBlur={focus.blur}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
        >
            <Animated.View
                style={[
                    focus.style,
                    {
                        padding: tvSize(14),
                        borderRadius: tvSize(12),
                        backgroundColor: focus.focused
                            ? "#ffffff"
                            : isSelected
                              ? "rgba(168,159,255,0.12)"
                              : "rgba(255,255,255,0.04)",
                        borderWidth: tvSize(2),
                        borderColor: focus.focused
                            ? "#ffffff"
                            : isSelected
                              ? "#9b90ff"
                              : "rgba(255,255,255,0.08)",
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: tvSize(16),
                    },
                ]}
            >
                <View style={{ flex: 1, gap: tvSize(4) }}>
                    <Text
                        style={{
                            fontSize: tvSize(16),
                            fontWeight: "600",
                            color: focus.focused
                                ? "#000000"
                                : isSelected
                                  ? "#b8b0ff"
                                  : "#ffffff",
                        }}
                        numberOfLines={1}
                    >
                        {name}
                    </Text>
                    {detail ? (
                        <Text
                            style={{
                                fontSize: tvSize(13),
                                color: focus.focused
                                    ? "#555555"
                                    : "rgba(255,255,255,0.4)",
                            }}
                            numberOfLines={1}
                        >
                            {detail}
                        </Text>
                    ) : null}
                </View>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(8),
                    }}
                >
                    {isLikely && (
                        <View
                            style={{
                                paddingHorizontal: tvSize(8),
                                paddingVertical: tvSize(3),
                                borderRadius: tvSize(6),
                                backgroundColor: focus.focused
                                    ? "rgba(5,150,105,0.16)"
                                    : "rgba(16,185,129,0.14)",
                                borderColor: focus.focused
                                    ? "#047857"
                                    : "rgba(16,185,129,0.24)",
                                borderWidth: tvSize(1),
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: tvSize(12),
                                    fontWeight: "bold",
                                    color: focus.focused ? "#047857" : "#a7f3d0",
                                }}
                            >
                                LIKELY
                            </Text>
                        </View>
                    )}
                    {isSelected && (
                        <Ionicons
                            name="checkmark-circle"
                            size={tvSize(20)}
                            color={focus.focused ? "#5b4fd8" : "#b8b0ff"}
                        />
                    )}
                </View>
            </Animated.View>
        </Pressable>
    );
});
