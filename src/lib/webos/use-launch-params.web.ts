import { getStoredServerUrl, useServerUrl } from "@/atoms/server.atoms"
import { useServerConnectionState } from "@/lib/offline"
import { type Href, router, usePathname, useSegments } from "expo-router"
import * as React from "react"
import {
    INITIAL_LAUNCH_STATE,
    isLaunchRequestShown,
    isLaunchStale,
    isPlayerPathname,
    LAUNCH_REQUEST_TTL_MS,
    type LaunchEvent,
    launchNavigation,
    type LaunchRequest,
    type LaunchState,
    reduceLaunchState,
} from "./launch-params"
import { onLaunchParams, readLaunchParams } from "./webos-platform"

// After the server connects, wait a moment so the start-up redirect to the
// Anime tab has happened before a screen is opened on top of it.
const OPEN_DELAY_MS = 300

let state: LaunchState = INITIAL_LAUNCH_STATE
const subscribers = new Set<() => void>()

function dispatch(event: LaunchEvent) {
    const next = reduceLaunchState(state, event)
    if (next === state) return
    state = next
    for (const notify of Array.from(subscribers)) notify()
}

// Monotonic: the TV's clock can jump when it syncs its time after booting.
function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function arrival(params: unknown) {
    let serverUrl: string | null = null
    try {
        serverUrl = getStoredServerUrl()
    } catch {
        // Storage unreadable: a server that is set later counts as another one.
    }
    return { params, at: now(), serverUrl }
}

function install() {
    dispatch({ type: "start", ...arrival(readLaunchParams()) })
    onLaunchParams((params, relaunch) => {
        dispatch({ type: relaunch ? "relaunch" : "launch", ...arrival(params) })
    })
}

// Listen from the start: the request is kept until the app can act on it.
if (typeof window !== "undefined") install()

function subscribe(callback: () => void) {
    subscribers.add(callback)
    return () => {
        subscribers.delete(callback)
    }
}

function getPending() {
    return state.pending
}

function openLaunchRequest(request: LaunchRequest, pathname: string, segments: readonly string[]) {
    if (isPlayerPathname(pathname)) {
        console.log("[webOS] launch parameters ignored while the player is open")
        return
    }
    if (isLaunchRequestShown(request, pathname)) return

    const { method, href } = launchNavigation(request, segments)
    if (method === "push") router.push(href as Href)
    else if (method === "dismissTo") router.dismissTo(href as Href)
    else router.navigate(href as Href)
}

/**
 * Opens what the app was launched or relaunched with (a show by AniList id,
 * the start screen or Discover) once the server is connected. A request waits
 * at most LAUNCH_REQUEST_TTL_MS and only for the server that was set when it
 * arrived. It never starts playback, and one that arrives while the player is
 * open is dropped.
 */
export function useWebOSLaunchParams() {
    const pending = React.useSyncExternalStore(subscribe, getPending, getPending)
    const connected = useServerConnectionState() === "connected"
    const serverUrl = useServerUrl()
    const pathname = usePathname()
    const segments = useSegments() as string[]
    const route = segments.join("/")

    React.useEffect(() => {
        if (!pending) return
        if (isLaunchStale(pending, now(), serverUrl)) {
            dispatch({ type: "done", pending })
            return
        }

        // Not connected yet: drop the request once it has waited too long.
        const delay = connected ? OPEN_DELAY_MS : Math.max(0, pending.at + LAUNCH_REQUEST_TTL_MS - now())
        const timer = setTimeout(() => {
            dispatch({ type: "done", pending })
            if (connected && !isLaunchStale(pending, now(), serverUrl)) {
                openLaunchRequest(pending.request, pathname, route.split("/"))
            }
        }, delay)
        return () => clearTimeout(timer)
    }, [connected, pathname, pending, route, serverUrl])
}
