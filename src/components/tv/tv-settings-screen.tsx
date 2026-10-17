import { useCurrentUser, useServerUrl } from "@/atoms/server.atoms"
import { TVConfirmDrawer } from "@/components/tv/tv-confirm-drawer"
import { usePreferredFocus, useTVFocus } from "@/components/tv/tv-focus"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { useServerConnectionState } from "@/lib/offline"
import { checkForOtaUpdateManually, getOtaVersionInfo } from "@/lib/ota/updates"
import { toast } from "@/lib/utils/toast"
import { useDeviceSummary } from "@/lib/webos/use-device-summary"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import { router } from "expo-router"
import * as React from "react"
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, Text, View } from "react-native"

type Confirm = "server" | "cache" | null

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

export function TVSettingsScreen() {
    const serverUrl = useServerUrl()
    const viewer = useCurrentUser()?.viewer
    const connection = useServerConnectionState()
    const [confirm, setConfirm] = React.useState<Confirm>(null)
    const [clearing, setClearing] = React.useState(false)
    const [checkingOta, setCheckingOta] = React.useState(false)
    const version = React.useMemo(() => getOtaVersionInfo(), [])
    const deviceSummary = useDeviceSummary()
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
