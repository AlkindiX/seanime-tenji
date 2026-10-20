import { buildSeaQuery } from "@/api/client/requests"
import {
    isWebsocketRefusedForOrigin,
    WEBSOCKET_NEEDS_PASSWORD_MESSAGE,
    websocketConnectionStateAtom,
    websocketLastCloseAtom,
    websocketTransportAtom,
} from "@/api/components/websocket-provider"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useCurrentUser, useServerStatus, useServerUrl } from "@/atoms/server.atoms"
import { TVConfirmDrawer } from "@/components/tv/tv-confirm-drawer"
import { TVDebugLogReceiverDrawer } from "@/components/tv/tv-debug-log-receiver-drawer"
import { usePreferredFocus, useTVFocus } from "@/components/tv/tv-focus"
import { TVNavScrim } from "@/components/tv/tv-nav-scrim"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { getConnectionSnapshot, getLastConnectionChange, subscribeToConnectionState } from "@/lib/connection-state"
import { getDebugLogReceiverLastError, getDebugLogReceiverUrl, sendToDebugLogReceiver, setDebugLogReceiverUrl } from "@/lib/debug-log-receiver"
import { useServerConnectionState } from "@/lib/offline"
import {
    clearOfflineLogs,
    getOfflineLogEntries,
    getOfflineLogEntriesForExport,
    isOfflineLoggingEnabled,
    setOfflineLoggingEnabled,
} from "@/lib/offline-logger"
import { checkForOtaUpdateManually, getOtaVersionInfo } from "@/lib/ota/updates"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { useDeviceSummary } from "@/lib/webos/use-device-summary"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import { router } from "expo-router"
import { useAtomValue } from "jotai"
import * as React from "react"
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, Text, View } from "react-native"

type Confirm = "server" | "cache" | "clear-logs" | null

const diagnosticsLog = logger("diagnostics")

function SectionCard({
    title,
    children,
}: {
    title: string
    children: React.ReactNode
}) {
    return (
        <View style={{ gap: tvSize(10) }}>
            <Text
                className="font-semibold uppercase text-white/30"
                style={{
                    paddingHorizontal: tvSize(6),
                    fontSize: tvSize(14),
                    letterSpacing: tvSize(2),
                }}
            >
                {title}
            </Text>
            <View
                style={{
                    borderRadius: tvSize(16),
                    borderWidth: tvSize(1),
                    borderColor: "rgba(255,255,255,0.07)",
                    backgroundColor: "rgba(255,255,255,0.025)",
                    overflow: "hidden",
                }}
            >
                {children}
            </View>
        </View>
    )
}

type SettingsRowProps = {
    label: string
    detail?: string
    icon: React.ComponentProps<typeof Ionicons>["name"]
    onPress: () => void
    preferred?: boolean
    disabled?: boolean
    danger?: boolean
    trailing?: React.ReactNode
    showChevron?: boolean
}

type RowRef = React.ElementRef<typeof Pressable>

const SettingsRow = React.memo(React.forwardRef<RowRef, SettingsRowProps>(function SettingsRow({
    label,
    detail,
    icon,
    onPress,
    preferred,
    disabled,
    danger,
    trailing,
    showChevron = true,
}, ref) {
    const focusState = useTVFocus(1.02, label)
    const isPreferred = usePreferredFocus(preferred)

    return (
        <Pressable
            ref={ref}
            onPress={onPress}
            hasTVPreferredFocus={isPreferred}
            disabled={disabled}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={detail ? `${label}, ${detail}` : label}
            accessibilityState={{ disabled: Boolean(disabled) }}
            style={{ opacity: disabled ? 0.4 : 1 }}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(18),
                        paddingVertical: tvSize(18),
                        paddingHorizontal: tvSize(22),
                        backgroundColor: focusState.focused
                            ? "rgba(255,255,255,0.1)"
                            : "transparent",
                    },
                ]}
            >
                <View
                    style={{
                        width: tvSize(42),
                        height: tvSize(42),
                        borderRadius: tvSize(10),
                        backgroundColor: danger
                            ? "rgba(239,68,68,0.15)"
                            : "rgba(255,255,255,0.06)",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Ionicons
                        name={icon}
                        size={tvSize(20)}
                        color={danger ? "#f87171" : "rgba(255,255,255,0.7)"}
                    />
                </View>
                <View style={{ flex: 1, gap: tvSize(2) }}>
                    <Text
                        className="font-semibold"
                        style={{
                            fontSize: tvSize(21),
                            color: danger ? "#f87171" : "#ffffff",
                        }}
                    >
                        {label}
                    </Text>
                    {detail ? (
                        <Text
                            className="text-white/40"
                            style={{ fontSize: tvSize(17) }}
                            numberOfLines={1}
                        >
                            {detail}
                        </Text>
                    ) : null}
                </View>
                {trailing}
                {showChevron && !trailing ? (
                    <Ionicons
                        name="chevron-forward"
                        size={tvSize(20)}
                        color="rgba(255,255,255,0.2)"
                    />
                ) : null}
            </Animated.View>
        </Pressable>
    )
}))

function focusRow(ref: React.RefObject<RowRef | null>) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => ref.current?.focus())
    })
}

function Divider() {
    return (
        <View
            style={{
                height: tvSize(1),
                marginLeft: tvSize(82),
                backgroundColor: "rgba(255,255,255,0.05)",
            }}
        />
    )
}

const noop = () => {}

function StatePill({ on }: { on: boolean }) {
    return (
        <View
            style={{
                paddingHorizontal: tvSize(12),
                paddingVertical: tvSize(4),
                borderRadius: tvSize(999),
                backgroundColor: on ? "rgba(134,239,172,0.15)" : "rgba(255,255,255,0.06)",
            }}
        >
            <Text
                className="font-semibold"
                style={{ fontSize: tvSize(15), color: on ? "#86efac" : "rgba(255,255,255,0.45)" }}
            >
                {on ? "On" : "Off"}
            </Text>
        </View>
    )
}

function timeAgo(at: number, now: number) {
    const seconds = Math.max(0, Math.round((now - at) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

/**
 * Debug logging for TVs, which have no clipboard or share sheet: logs are kept on the
 * TV and can be streamed to `npm run debug:logs` on a computer.
 */
function DiagnosticsSection({ onClearLogs }: { onClearLogs: () => void }) {
    const serverUrl = useServerUrl()
    const snapshot = React.useSyncExternalStore(subscribeToConnectionState, getConnectionSnapshot)
    const websocketState = useAtomValue(websocketConnectionStateAtom)
    const [loggingEnabled, setLoggingEnabled] = React.useState(isOfflineLoggingEnabled)
    const [entryCount, setEntryCount] = React.useState(() => getOfflineLogEntries().length)
    const [receiverUrl, setReceiverUrl] = React.useState(getDebugLogReceiverUrl)
    const [receiverError, setReceiverError] = React.useState(getDebugLogReceiverLastError)
    const [receiverOpen, setReceiverOpen] = React.useState(false)
    const [sending, setSending] = React.useState(false)
    const [testing, setTesting] = React.useState(false)
    const receiverRef = React.useRef<RowRef>(null)

    // the entry count, receiver errors and "12s ago" change without any React state
    // changing; `now` is state so the React Compiler doesn't cache the "ago" text
    const [now, setNow] = React.useState(Date.now)
    React.useEffect(() => {
        const timer = setInterval(() => {
            setEntryCount(getOfflineLogEntries().length)
            setReceiverError(getDebugLogReceiverLastError())
            setNow(Date.now())
        }, 2000)
        return () => clearInterval(timer)
    }, [])

    const toggleLogging = React.useCallback(() => {
        const next = !loggingEnabled
        setOfflineLoggingEnabled(next)
        setLoggingEnabled(next)
        setEntryCount(getOfflineLogEntries().length)
        toast.info(next ? "Debug logging on" : "Debug logging off")
    }, [loggingEnabled])

    const saveReceiver = React.useCallback((url: string | null) => {
        setDebugLogReceiverUrl(url)
        setReceiverUrl(url)
        setReceiverError(null)
        if (!url) {
            toast.info("Stopped sending logs")
            return
        }
        void sendToDebugLogReceiver([], url).then(result => {
            if (result.ok) toast.success(`Log receiver reached at ${url}`)
            else toast.error(`Can't reach ${url}: ${result.error}`)
            setReceiverError(result.ok ? null : result.error)
        })
    }, [])

    const sendSavedLogs = React.useCallback(() => {
        if (sending) return
        setSending(true)
        void sendToDebugLogReceiver(getOfflineLogEntriesForExport())
            .then(result => {
                if (result.ok) toast.success(result.sent === 1 ? "Sent 1 log entry" : `Sent ${result.sent} log entries`)
                else toast.error(`Couldn't send logs: ${result.error}`)
                setReceiverError(result.ok ? null : result.error)
            })
            .finally(() => setSending(false))
    }, [sending])

    const testConnection = React.useCallback(() => {
        if (testing || !serverUrl) return
        setTesting(true)
        const startedAt = Date.now()
        const current = getConnectionSnapshot()
        diagnosticsLog.info("Connection test started", {
            server: current.serverReachability,
            network: current.hasNetwork,
            websocket: websocketState,
            lastChange: getLastConnectionChange(),
        })
        void buildSeaQuery({
            serverUrl,
            endpoint: API_ENDPOINTS.STATUS.GetStatus.endpoint,
            method: "GET",
            muteError: true,
            bypassOfflineCheck: true,
        })
            .then(() => {
                const durationMs = Date.now() - startedAt
                diagnosticsLog.info("Connection test passed", { durationMs })
                toast.success(`Server answered in ${durationMs} ms`)
            })
            .catch((error: { error?: string, status?: number }) => {
                diagnosticsLog.warning("Connection test failed", {
                    status: error?.status ?? null,
                    error: error?.error ?? String(error),
                })
                toast.error(`Server test failed: ${error?.error ?? "unknown error"}`)
            })
            .finally(() => setTesting(false))
    }, [serverUrl, testing, websocketState])

    // changes only together with the snapshot
    const lastChange = React.useMemo(() => {
        void snapshot
        return getLastConnectionChange()
    }, [snapshot])
    const connectionDetail = [
        `server ${snapshot.serverReachability}`,
        `network ${snapshot.hasNetwork ? "up" : "down"}`,
        `socket ${websocketState}`,
        lastChange ? `${lastChange.source}, ${timeAgo(lastChange.at, now)}` : null,
    ].filter(Boolean).join(" · ")

    return (
        <SectionCard title="Diagnostics">
            <SettingsRow
                label="Debug Logging"
                detail={loggingEnabled
                    ? `${entryCount} ${entryCount === 1 ? "entry" : "entries"} saved on this TV`
                    : "Turn on, reproduce the problem, then send the logs"}
                icon="bug-outline"
                onPress={toggleLogging}
                trailing={<StatePill on={loggingEnabled} />}
            />
            <Divider />
            <SettingsRow
                ref={receiverRef}
                label="Log Receiver"
                detail={receiverUrl
                    ? receiverError ? `${receiverUrl} · ${receiverError}` : `Sending live to ${receiverUrl}`
                    : "Not set · run npm run debug:logs on a computer"}
                icon="desktop-outline"
                onPress={() => setReceiverOpen(true)}
            />
            <Divider />
            <SettingsRow
                label={sending ? "Sending Logs…" : "Send Saved Logs"}
                detail={receiverUrl ? `All ${entryCount} saved entries to the receiver` : "Set a log receiver first"}
                icon="cloud-upload-outline"
                disabled={!receiverUrl || sending}
                onPress={sendSavedLogs}
                trailing={sending ? <ActivityIndicator size="small" color="white" /> : undefined}
                showChevron={false}
            />
            <Divider />
            <SettingsRow
                label={testing ? "Testing Connection…" : "Test Connection"}
                detail={connectionDetail}
                icon="pulse-outline"
                disabled={!serverUrl || testing}
                onPress={testConnection}
                trailing={testing ? <ActivityIndicator size="small" color="white" /> : undefined}
                showChevron={false}
            />
            <Divider />
            <SettingsRow
                label="Clear Logs"
                detail="Remove the logs saved on this TV"
                icon="trash-outline"
                onPress={onClearLogs}
                showChevron={false}
            />

            <TVDebugLogReceiverDrawer
                open={receiverOpen}
                onOpenChange={open => {
                    setReceiverOpen(open)
                    if (!open) focusRow(receiverRef)
                }}
                currentUrl={receiverUrl}
                onSave={saveReceiver}
            />
        </SectionCard>
    )
}

export function TVSettingsScreen() {
    const serverUrl = useServerUrl()
    const viewer = useCurrentUser()?.viewer
    const connection = useServerConnectionState()
    const [confirm, setConfirm] = React.useState<Confirm>(null)
    const [clearing, setClearing] = React.useState(false)
    const [checkingOta, setCheckingOta] = React.useState(false)
    const version = React.useMemo(() => getOtaVersionInfo(), [])
    const deviceSummary = useDeviceSummary()
    const socketState = useAtomValue(websocketConnectionStateAtom)
    const socketLastClose = useAtomValue(websocketLastCloseAtom)
    const socketTransport = useAtomValue(websocketTransportAtom)
    const serverStatus = useServerStatus()
    // Torrent and debrid streams are started and followed over the websocket.
    const liveUpdatesDetail = socketState === "connected"
        ? socketTransport === "relay" ? "Connected through the app's relay service" : "Connected"
        : isWebsocketRefusedForOrigin(serverStatus)
            ? `Refused by the server. ${WEBSOCKET_NEEDS_PASSWORD_MESSAGE}`
            : `Not connected${socketLastClose ? ` (closed with code ${socketLastClose.code}${socketLastClose.reason ? `: ${socketLastClose.reason}` : ""})` : ""}. Torrent and debrid streams need it.`
    const cacheRef = React.useRef<RowRef>(null)
    const serverRef = React.useRef<RowRef>(null)

    const clearCache = React.useCallback(() => {
        if (clearing) return
        void (async () => {
            try {
                setClearing(true)
                const [memory, disk] = await Promise.all([
                    Image.clearMemoryCache(),
                    Image.clearDiskCache(),
                ])
                if (!memory && !disk) {
                    toast.info("Image cache was already empty")
                    return
                }
                toast.success("Image cache cleared")
            } catch {
                toast.error("Failed to clear image cache")
            } finally {
                setClearing(false)
                focusRow(cacheRef)
            }
        })()
    }, [clearing])

    const checkOta = React.useCallback(() => {
        if (checkingOta) return

        setCheckingOta(true)
        void checkForOtaUpdateManually()
            .finally(() => setCheckingOta(false))
    }, [checkingOta])

    const connectionLabel = connection === "connected"
        ? "Connected to server"
        : connection === "connecting"
            ? "Checking server"
            : "Offline"
    const dot = connection === "connected"
        ? "#86efac"
        : connection === "connecting"
            ? "#fcd34d"
            : "#fca5a5"

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                    paddingHorizontal: TV.gutter,
                    paddingTop: TV.navInset + tvSize(18),
                    paddingBottom: tvSize(90),
                }}
                showsVerticalScrollIndicator={false}
            >
                <View style={{ maxWidth: tvSize(740), width: "100%", gap: tvSize(30), marginHorizontal: "auto" }}>

                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: tvSize(22),
                            padding: tvSize(24),
                            borderRadius: tvSize(18),
                            borderWidth: tvSize(1),
                            borderColor: "rgba(255,255,255,0.08)",
                            backgroundColor: "rgba(255,255,255,0.03)",
                        }}
                    >
                        {viewer?.avatar?.large ? (
                            <Image
                                source={{ uri: viewer.avatar.large }}
                                style={{
                                    width: tvSize(72),
                                    height: tvSize(72),
                                    borderRadius: tvSize(36),
                                }}
                                contentFit="cover"
                                transition={120}
                            />
                        ) : (
                            <View
                                style={{
                                    width: tvSize(72),
                                    height: tvSize(72),
                                    borderRadius: tvSize(36),
                                    backgroundColor: "rgba(255,255,255,0.08)",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <Ionicons name="person" size={tvSize(30)} color="rgba(255,255,255,0.5)" />
                            </View>
                        )}
                        <View style={{ flex: 1, gap: tvSize(4) }}>
                            <Text className="font-bold text-white" style={{ fontSize: tvSize(26) }}>
                                {viewer?.name || "User"}
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(8) }}>
                                <View
                                    style={{
                                        width: tvSize(8),
                                        height: tvSize(8),
                                        borderRadius: tvSize(4),
                                        backgroundColor: dot,
                                    }}
                                />
                                <Text className="text-white/50" style={{ fontSize: tvSize(17) }}>
                                    {connectionLabel}
                                </Text>
                                <Text className="text-white/25" style={{ fontSize: tvSize(15) }}>
                                    ·
                                </Text>
                                <Text className="text-white/25" style={{ fontSize: tvSize(15) }} numberOfLines={1}>
                                    {serverUrl}
                                </Text>
                            </View>
                        </View>
                        <Text className="text-white/20" style={{ fontSize: tvSize(14) }}>
                            v{version.appVersion} · {version.otaVersion}
                        </Text>
                    </View>

                    <SectionCard title="App">
                        <SettingsRow
                            ref={cacheRef}
                            label={clearing ? "Clearing Image Cache…" : "Clear Image Cache"}
                            detail="Purge cached posters, banners, and avatars"
                            icon="images-outline"
                            preferred
                            disabled={clearing}
                            onPress={() => setConfirm("cache")}
                            trailing={clearing ? <ActivityIndicator size="small" color="white" /> : undefined}
                            showChevron={!clearing}
                        />
                        {/* The webOS (web) build is updated by reinstalling the package */}
                        {Platform.OS !== "web" && <>
                            <Divider />
                            <SettingsRow
                                label={checkingOta ? "Checking for Update…" : "Check OTA Update"}
                                detail={`${version.otaVersion} · ${version.detail}`}
                                icon="code-download-outline"
                                disabled={checkingOta}
                                onPress={checkOta}
                                trailing={checkingOta ? <ActivityIndicator size="small" color="white" /> : undefined}
                                showChevron={false}
                            />
                        </>}
                        <Divider />
                        <SettingsRow
                            ref={serverRef}
                            label="Change Server URL"
                            detail="Return to the connection screen"
                            icon="server-outline"
                            danger
                            onPress={() => setConfirm("server")}
                        />
                    </SectionCard>

                    <DiagnosticsSection onClearLogs={() => setConfirm("clear-logs")} />

                    {/* webOS only: what the TV reports about itself, for bug reports */}
                    {deviceSummary && (
                        <SectionCard title="Device">
                            <SettingsRow
                                label="This TV"
                                detail={deviceSummary.device}
                                icon="tv-outline"
                                onPress={noop}
                                showChevron={false}
                            />
                            <Divider />
                            <SettingsRow
                                label="Live updates"
                                detail={liveUpdatesDetail}
                                icon="pulse-outline"
                                onPress={noop}
                                showChevron={false}
                            />
                            {deviceSummary.formats.length > 0 && <>
                                <Divider />
                                <SettingsRow
                                    label="Video formats"
                                    detail={deviceSummary.formats.join(" · ")}
                                    icon="film-outline"
                                    onPress={noop}
                                    showChevron={false}
                                />
                            </>}
                        </SectionCard>
                    )}

                </View>
            </ScrollView>
            <TVNavScrim />

            <TVConfirmDrawer
                open={confirm === "cache"}
                onOpenChange={open => {
                    if (!open) {
                        setConfirm(null)
                        focusRow(cacheRef)
                    }
                }}
                title="Clear image cache?"
                text="This removes cached posters, banners, and avatars. Images will download again when they are shown."
                confirmLabel="Clear cache"
                danger
                onConfirm={clearCache}
            />
            <TVConfirmDrawer
                open={confirm === "clear-logs"}
                onOpenChange={open => {
                    if (!open) setConfirm(null)
                }}
                title="Clear logs?"
                text="Diagnostic logs and crash records saved on this TV will be removed."
                confirmLabel="Clear logs"
                danger
                onConfirm={() => {
                    clearOfflineLogs()
                    toast.success("Logs cleared")
                }}
            />
            <TVConfirmDrawer
                open={confirm === "server"}
                onOpenChange={open => {
                    if (!open) {
                        setConfirm(null)
                        focusRow(serverRef)
                    }
                }}
                title="Change server URL?"
                text="You will return to the server connection screen. Your current server stays saved until you connect to another one."
                confirmLabel="Continue"
                onConfirm={() => router.push("/(out)/set-server-url" as never)}
            />
        </View>
    )
}
