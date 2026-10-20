import { Status } from "@/api/generated/types"
import { createAtomStorage, getStoredJsonValue } from "@/atoms/storage"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"

/**
 * Server URL
 */

const serverUrlAtom = atomWithStorage<string | null>("sea-server-url", null, createAtomStorage<string | null>(), { getOnInit: true })
export const SERVER_AUTH_TOKEN_STORAGE_KEY = "sea-server-auth-token"
const serverAuthTokenAtom = atomWithStorage<string | null>(SERVER_AUTH_TOKEN_STORAGE_KEY,
    null,
    createAtomStorage<string | null>(),
    { getOnInit: true })

export function useServerUrl() {
    return useAtomValue(serverUrlAtom)
}

export function useServerUrlProtocol() {
    const serverUrl = useServerUrl()
    return serverUrl ? new URL(serverUrl).protocol : null
}

export function useSetServerUrl() {
    return useSetAtom(serverUrlAtom)
}

export function useServerAuthToken() {
    return useAtomValue(serverAuthTokenAtom)
}

export function useSetServerAuthToken() {
    return useSetAtom(serverAuthTokenAtom)
}

export function getStoredServerAuthToken() {
    return getStoredJsonValue<string | null>(SERVER_AUTH_TOKEN_STORAGE_KEY)
}

/**
 * Server Status
 */

export const serverStatusAtom = atomWithStorage<Status | null>("sea-server-status", null, createAtomStorage<Status | null>(), { getOnInit: true })

export function useServerStatus() {
    return useAtomValue(serverStatusAtom)
}

export function useCurrentUser() {
    const serverStatus = useAtomValue(serverStatusAtom)

    // React.useEffect(() => {
    //     logger("useCurrentUser").info(serverStatus)
    // }, [serverStatus])

    return serverStatus?.user
}

export function useSetServerStatus() {
    return useSetAtom(serverStatusAtom)
}

/**
 * The status settings a media card shows. Read one by one, a card re-renders
 * when that value changes rather than whenever the status is refetched; a
 * screen holds dozens of cards.
 */
const showAnimeUnwatchedCountAtom = atom(get => get(serverStatusAtom)?.themeSettings?.showAnimeUnwatchedCount ?? true)
const hideAudienceScoreAtom = atom(get => !!get(serverStatusAtom)?.settings?.anilist?.hideAudienceScore)
const blurAdultContentAtom = atom(get => !!get(serverStatusAtom)?.settings?.anilist?.blurAdultContent)

export function useMediaCardSettings() {
    return {
        showUnwatchedCount: useAtomValue(showAnimeUnwatchedCountAtom),
        hideAudienceScore: useAtomValue(hideAudienceScoreAtom),
        blurAdultContent: useAtomValue(blurAdultContentAtom),
    }
}
