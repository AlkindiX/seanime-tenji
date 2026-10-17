import NetInfo from "@react-native-community/netinfo"
import { router } from "expo-router"
import * as React from "react"
import { onPointerActivity, setFallbackBackHandler } from "./remote"

// NetInfo's web build probes "/" for internet reachability, which a file://
// app can't fetch. Connectivity comes from navigator.onLine instead.
NetInfo.configure({ reachabilityShouldRun: () => false })

/**
 * Back that no Modal or BackHandler listener consumed goes back in the
 * router, which is what React Navigation does on Android TV. On the first
 * screen it falls through to leaving the app.
 */
export function useWebOSRuntime() {
    React.useEffect(() => {
        setFallbackBackHandler(() => {
            if (!router.canGoBack()) return false
            router.back()
            return true
        })
        return () => setFallbackBackHandler(null)
    }, [])
}

/** Runs `callback` while the Magic Remote pointer moves or clicks (throttled in remote.ts). */
export function usePointerActivity(callback: () => void) {
    const latest = React.useRef(callback)
    latest.current = callback

    React.useEffect(() => onPointerActivity(() => latest.current()), [])
}
