import { LONG_REQUEST_TIMEOUT_MS } from "@/api/client/request-control"
import { buildSeaQuery } from "@/api/client/requests"
import type { SearchTorrent_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type {
    Anime_AutoSelectProfile,
    Anime_Entry,
    ExtensionRepo_AnimeTorrentProviderExtensionItem,
    HibikeTorrent_AnimeTorrent,
    Status,
    Torrent_SearchData,
} from "@/api/generated/types"
import { useServerUrl } from "@/atoms/server.atoms"
import { logger } from "@/lib/utils/logger"
import * as React from "react"
import { Platform } from "react-native"
import {
    type AutoSelectProvider,
    choosePlayableRelease,
    defaultAutoSelectProfile,
    type PlayableReleaseChoice,
    rankLikeAutoSelect,
    searchLikeAutoSelect,
} from "./auto-select-ranking"

const log = logger("playable-auto-release")

/** How long the TV looks at the releases itself before leaving the choice to the server as usual. */
const CHECK_TIMEOUT_MS = 25_000

type Params = {
    entry: Anime_Entry
    serverStatus: Status | null | undefined
    providerExtensions: ExtensionRepo_AnimeTorrentProviderExtensionItem[] | undefined
}

/**
 * webOS: before an auto-selected stream, runs the server's auto-select
 * ranking on the same search results. When the release it would pick has
 * audio LG TVs don't play in a video (FLAC) and a comparable release
 * without it exists, resolves that release; otherwise null, and the server
 * picks as usual. Its searches are cached on the server, so its own
 * auto-select doesn't search again.
 */
export function usePlayableAutoRelease(params: Params) {
    const serverUrl = useServerUrl()
    const latest = React.useRef(params)
    latest.current = params

    return React.useCallback(async (episodeNumber: number, mode: "torrent" | "debrid"): Promise<PlayableReleaseChoice<HibikeTorrent_AnimeTorrent> | null> => {
        const { entry, serverStatus, providerExtensions } = latest.current
        const media = entry.media
        if (Platform.OS !== "web" || !serverUrl || !media || !providerExtensions?.length) return null

        const check = async () => {
            const saved = await buildSeaQuery<Anime_AutoSelectProfile>({
                serverUrl,
                endpoint: API_ENDPOINTS.TORRENT_SEARCH.GetAutoSelectProfile.endpoint,
                method: "GET",
                muteError: true,
            }).catch(() => undefined)
            // The server returns an empty profile (no dbId) when none was saved.
            const profile = saved?.dbId
                ? saved
                : defaultAutoSelectProfile(mode === "debrid"
                    ? serverStatus?.debridSettings?.streamPreferredResolution
                    : serverStatus?.torrentstreamSettings?.preferredResolution)

            const byId = new Map(providerExtensions.map(extension => [extension.id, extension]))
            const defaultId = serverStatus?.settings?.library?.torrentProvider
            const ids = profile.providers?.length
                ? profile.providers.slice(0, 3)
                : [defaultId && byId.has(defaultId) ? defaultId : providerExtensions[0].id]
            const providers: AutoSelectProvider[] = ids.flatMap((id) => {
                const extension = byId.get(id)
                return extension ? [{ id, canSmartSearch: !!extension.settings?.canSmartSearch }] : []
            })
            if (providers.length === 0) return null

            const results = await searchLikeAutoSelect({
                search: variables => buildSeaQuery<Torrent_SearchData, SearchTorrent_Variables>({
                    serverUrl,
                    endpoint: API_ENDPOINTS.TORRENT_SEARCH.SearchTorrent.endpoint,
                    method: "POST",
                    data: variables,
                    muteError: true,
                    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
                }),
                providers,
                media,
                episodeNumber,
                profile,
            })
            const cached = mode === "debrid" ? results.cached : undefined
            const ranked = rankLikeAutoSelect(results.torrents, results.metadata, profile, cached)
            const choice = choosePlayableRelease(ranked, cached)
            log.info("Checked the release auto-select would pick", {
                episodeNumber,
                mode,
                candidates: ranked.length,
                top: ranked[0]?.torrent.name,
                instead: choice?.torrent.name,
            })
            return choice
        }

        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                log.warning("Checking the releases took too long; leaving the choice to the server")
                resolve(null)
            }, CHECK_TIMEOUT_MS)
        })
        try {
            return await Promise.race([check(), timeout])
        } catch (error) {
            log.warning("Could not check the releases; leaving the choice to the server", error)
            return null
        } finally {
            clearTimeout(timer)
        }
    }, [serverUrl])
}
