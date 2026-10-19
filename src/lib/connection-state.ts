import NetInfo, { type NetInfoState } from "@react-native-community/netinfo"
import { onlineManager } from "@tanstack/react-query"
import { useEffect } from "react"
import { AppState, Platform } from "react-native"
import { logger } from "./utils/logger"
import { getStoredManualOfflineMode } from "./offline/manual-offline-mode"

export type ServerReachability = "unknown" | "reachable" | "unreachable"

type ConnectionSnapshot = {
    hasNetwork: boolean
    serverReachability: ServerReachability
}

let snapshot: ConnectionSnapshot = {
    hasNetwork: true,
    serverReachability: "unknown",
}

const listeners = new Set<() => void>()
const log = logger("connection-state")

export type ConnectionChange = {
    source: string
    at: number
}

// what moved the snapshot last, shown in TV settings and the logs
let lastChange: ConnectionChange | null = null

function syncOnlineManager(): void {
    onlineManager.setOnline(snapshot.hasNetwork && !getStoredManualOfflineMode())
}

function emitChange(): void {
    listeners.forEach(listener => listener())
}

function updateSnapshot(source: string, updater: (current: ConnectionSnapshot) => ConnectionSnapshot): void {
    const next = updater(snapshot)

    if (
        next.hasNetwork === snapshot.hasNetwork
        && next.serverReachability === snapshot.serverReachability
    ) {
        return
    }

    log.info(
        `network ${snapshot.hasNetwork ? "up" : "down"} -> ${next.hasNetwork ? "up" : "down"}, `
        + `server ${snapshot.serverReachability} -> ${next.serverReachability}`,
        { source, manualOffline: getStoredManualOfflineMode() },
    )
    snapshot = next
    lastChange = { source, at: Date.now() }
    syncOnlineManager()
    emitChange()
}

function hasDeviceNetwork(state: NetInfoState): boolean {
    return state.isConnected !== false
}

let lastNetInfoLog = ""

function applyNetInfoState(state: NetInfoState): void {
    const summary = JSON.stringify({
        type: state.type,
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
    })
    if (summary !== lastNetInfoLog) {
        lastNetInfoLog = summary
        log.debug("NetInfo", summary)
    }

    const nextHasNetwork = hasDeviceNetwork(state)
    setDeviceNetworkState(nextHasNetwork, `netinfo ${state.type}`)
}

syncOnlineManager()

export function subscribeToConnectionState(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function getConnectionSnapshot(): ConnectionSnapshot {
    return snapshot
}

export function getLastConnectionChange(): ConnectionChange | null {
    return lastChange
}

export function setDeviceNetworkState(hasNetwork: boolean, source = "device network"): void {
    updateSnapshot(source, current => {
        if (!hasNetwork) {
            return {
                hasNetwork: false,
                serverReachability: "unreachable",
            }
        }

        return {
            hasNetwork: true,
            serverReachability: current.hasNetwork ? current.serverReachability : "unknown",
        }
    })
}

export function degradeServerReachability(source: string): void {
    updateSnapshot(source, current => {
        if (!current.hasNetwork || current.serverReachability !== "reachable") {
            return current
        }

        return {
            ...current,
            serverReachability: "unknown",
        }
    })
}

export function markServerReachable(source: string): void {
    updateSnapshot(source, current => {
        if (current.serverReachability === "reachable") {
            return current
        }

        return {
            ...current,
            serverReachability: "reachable",
        }
    })
}

export function markServerUnreachable(source: string): void {
    updateSnapshot(source, current => {
        if (!current.hasNetwork || current.serverReachability === "unreachable") {
            return current
        }

        return {
            ...current,
            serverReachability: "unreachable",
        }
    })
}

export function isManualOfflineModeEnabled(): boolean {
    return getStoredManualOfflineMode()
}

export function isGlobalConnected(): boolean {
    return !isManualOfflineModeEnabled()
        && snapshot.hasNetwork
        && snapshot.serverReachability !== "unreachable"
}

export function syncManualOfflineConnectionState(): void {
    syncOnlineManager()
    emitChange()
}

export function useConnectionStateMonitor(): void {
    useEffect(() => {
        let mounted = true

        const handleState = (state: NetInfoState) => {
            if (!mounted) return
            applyNetInfoState(state)
        }

        const unsubscribe = NetInfo.addEventListener(handleState)

        NetInfo.fetch()
            .then(handleState)
            .catch(error => {
                log.warning("NetInfo.fetch failed", error)
            })

        // suspends and resumes explain most dropped connections on TVs
        const appStateSub = AppState.addEventListener("change", state => {
            log.info(`app state ${state}`, {
                server: snapshot.serverReachability,
                network: snapshot.hasNetwork,
            })
        })

        const doc = Platform.OS === "web"
            ? (globalThis as { document?: Document }).document
            : undefined
        const onVisibility = () => log.info(`document ${doc?.visibilityState}`)
        const onRelaunch = () => log.info("webOS relaunch")
        const onOnline = () => log.info("browser online")
        const onOffline = () => log.info("browser offline")
        doc?.addEventListener("visibilitychange", onVisibility)
        doc?.addEventListener("webOSRelaunch", onRelaunch)
        globalThis.addEventListener?.("online", onOnline)
        globalThis.addEventListener?.("offline", onOffline)

        return () => {
            mounted = false
            unsubscribe()
            appStateSub.remove()
            doc?.removeEventListener("visibilitychange", onVisibility)
            doc?.removeEventListener("webOSRelaunch", onRelaunch)
            globalThis.removeEventListener?.("online", onOnline)
            globalThis.removeEventListener?.("offline", onOffline)
        }
    }, [])
}
