import NetInfo from "@react-native-community/netinfo"
import { router } from "expo-router"
import * as React from "react"
import { setFallbackBackHandler } from "./remote"

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
