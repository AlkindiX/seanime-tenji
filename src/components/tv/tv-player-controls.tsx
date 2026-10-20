import { BUFFER_FILL } from "@/components/features/player/constants"
import { requestTVFocus, tvKeyAction } from "@/components/tv/tv-native"
import { formatTime, isSkippableChapter } from "@/components/features/player/helpers"
import { TVFocusScaleView, useTVFocus } from "@/components/tv/tv-focus"
import { tvSize } from "@/components/tv/tv-scale"
import { TVStreamTelemetry } from "@/components/tv/tv-stream-telemetry"
import { useScrubSnapshot } from "@/components/tv/use-tv-scrub"
import type { PlayerChapter, PlayerState } from "@/lib/player"
import { formatScrubOffset, type ScrubController, type ScrubSnapshot } from "@/lib/player/scrub"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { useBackIntercept } from "@/lib/webos/use-back-intercept"
import { LinearGradient } from "expo-linear-gradient"
import Captions from "lucide-react-native/icons/captions"
import List from "lucide-react-native/icons/list"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import Settings from "lucide-react-native/icons/settings"
import SkipForward from "lucide-react-native/icons/skip-forward"
import X from "lucide-react-native/icons/x"
import * as React from "react"
import {
    Animated,
    type GestureResponderEvent,
    Platform,
    Pressable,
    Text,
    TVFocusGuideView,
    useTVEventHandler,
    View,
} from "react-native"

const FOCUS_BORDER = "#ffffff"

type PressableRef = React.ElementRef<typeof Pressable>

/**
 * Where a Magic Remote pointer click landed on a bar, from 0 to 1. Null for
 * presses that came from the remote's OK key, which react-native-web reports
 * with the key event.
 */
function pointerFraction(event: GestureResponderEvent | undefined): number | null {
    if (Platform.OS !== "web" || !event) return null
    // Clicks arrive as React events; OK arrives as the DOM keyup event itself.
    const native = (event.nativeEvent ?? event) as unknown as { type?: string; clientX?: number }
    const target = event.currentTarget as unknown as { getBoundingClientRect?: () => { left: number; width: number } }
    if (native.type !== "click" || typeof native.clientX !== "number" || !target?.getBoundingClientRect) return null
    const box = target.getBoundingClientRect()
    if (box.width <= 0) return null
    return Math.max(0, Math.min(1, (native.clientX - box.left) / box.width))
}

/** True for a Magic Remote pointer click, false for the remote's OK key (see pointerFraction). */
function isPointerClick(event: GestureResponderEvent | undefined) {
    if (Platform.OS !== "web" || !event) return false
    const native = (event.nativeEvent ?? event) as unknown as { type?: string }
    return native.type === "click"
}

type ControlProps = {
    label: string
    icon: (color: string) => React.ReactNode
    onPress: () => void
    preferred?: boolean
    primary?: boolean
    wide?: boolean
    disabled?: boolean
    onFocus?: () => void
}

const TVPlayerControl = React.forwardRef<React.ElementRef<typeof Pressable>, ControlProps>(
    ({
        label,
        icon,
        onPress,
        preferred,
        primary,
        wide,
        disabled,
        onFocus,
    }, ref) => {
        const focus = useTVFocus(1.04)
        return (
            <Pressable
                ref={ref}
                onPress={onPress}
                disabled={disabled}
                hasTVPreferredFocus={preferred}
                onFocus={() => {
                    focus.focus()
                    onFocus?.()
                }}
                onBlur={focus.blur}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled: Boolean(disabled) }}
                style={{
                    width: tvSize(wide ? 156 : 92),
                    flexShrink: 0,
                    opacity: disabled ? 0.35 : 1,
                }}
            >
                <Animated.View
                    style={[
                        focus.style,
                        {
                            alignSelf: "center",
                            width: tvSize(primary ? 72 : 62),
                            height: tvSize(primary ? 72 : 62),
                            borderRadius: tvSize(primary ? 36 : 31),
                            borderWidth: tvSize(3),
                            borderColor: focus.focused
                                ? FOCUS_BORDER
                                : "transparent",
                            backgroundColor: focus.focused
                                ? "rgba(255,255,255,0.16)"
                                : primary
                                    ? "rgba(255,255,255,0.12)"
                                    : "rgba(255,255,255,0.06)",
                            alignItems: "center",
                            justifyContent: "center",
                        },
                    ]}
                >
                    {icon("#ffffff")}
                </Animated.View>
                <Text
                    className="font-semibold"
                    numberOfLines={1}
                    style={{
                        marginTop: tvSize(8),
                        color: focus.focused ? "#ffffff" : "rgba(255,255,255,0.58)",
                        fontSize: tvSize(16),
                        textAlign: "center",
                    }}
                >
                    {label}
                </Text>
            </Pressable>
        )
    },
)

TVPlayerControl.displayName = "TVPlayerControl"

function TVPlayerExit({
    onPress,
    onFocus,
}: {
    onPress: () => void
    onFocus: () => void
}) {
    const focus = useTVFocus(1.04)

    return (
        <Pressable
            onPress={onPress}
            onFocus={() => {
                focus.focus()
                onFocus()
            }}
            onBlur={focus.blur}
            accessibilityRole="button"
            accessibilityLabel="Leave player"
            style={{
                position: "absolute",
                top: tvSize(52),
                left: tvSize(58),
                zIndex: 2,
            }}
        >
            <Animated.View
                style={[
                    focus.style,
                    {
                        width: tvSize(58),
                        height: tvSize(58),
                        borderRadius: tvSize(29),
                        borderWidth: tvSize(3),
                        borderColor: focus.focused ? FOCUS_BORDER : "transparent",
                        backgroundColor: focus.focused
                            ? "rgba(255,255,255,0.16)"
                            : "rgba(255,255,255,0.06)",
                        alignItems: "center",
                        justifyContent: "center",
                    },
                ]}
            >
                <X size={tvSize(25)} color="#ffffff" />
            </Animated.View>
        </Pressable>
    )
}

type Props = {
    visible: boolean
    source: MobilePlaybackSource | null
    state: PlayerState
    chapters: PlayerChapter[]
    displayTime: number
    progress: number
    buffered: number
    longSeekVisible: boolean
    seekSec: number
    canPlayNext: boolean
    canShowEpisodes: boolean
    skipLabel?: string
    onSkip?: () => void
    onTogglePlayPause: () => void
    onSeekRelative: (seconds: number) => void
    /** Seeks to a time in seconds; used when the timeline is clicked with the pointer. */
    onSeekTo?: (seconds: number) => void
    onPlayNext: () => void
    onOpenEpisodes: () => void
    onOpenTracks: () => void
    onOpenSettings: () => void
    onExit: () => void
    onShowControls: () => void
    onControlFocus: () => void
    onControlAction: () => void
    focusWhenHidden?: boolean
    /**
     * webOS: seeking goes through this (left/right move a target that is
     * seeked once they stop), and the controls take their YouTube TV-style
     * layout. Without it (Android TV, tvOS) the controls are as before.
     */
    scrub?: ScrubController
}

export function TVPlayerControls({
    visible,
    source,
    state,
    chapters,
    displayTime,
    progress,
    buffered,
    longSeekVisible,
    seekSec,
    canPlayNext,
    canShowEpisodes,
    skipLabel,
    onSkip,
    onTogglePlayPause,
    onSeekRelative,
    onSeekTo,
    onPlayNext,
    onOpenEpisodes,
    onOpenTracks,
    onOpenSettings,
    onExit,
    onShowControls,
    onControlFocus,
    onControlAction,
    focusWhenHidden = true,
    scrub,
}: Props) {
    const playRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
    const episodesRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
    const tracksRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
    const settingsRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
    const returnRef = React.useRef<"episodes" | "tracks" | "settings" | null>(null)
    const [playTarget, setPlayTarget] = React.useState<React.ElementRef<typeof Pressable> | null>(null)
    const hiddenRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
    const [barFocused, setBarFocused] = React.useState(false)
    const segments = React.useMemo(() => getSegments(chapters, state.duration), [chapters, state.duration])
    const bindPlay = React.useCallback((target: React.ElementRef<typeof Pressable> | null) => {
        playRef.current = target
        setPlayTarget(target)
    }, [])

    // webOS scrubbing (see src/lib/player/scrub.ts).
    const barRef = React.useRef<PressableRef>(null)
    // Read by the key handler, which can run before the focus re-render lands.
    const barFocusedRef = React.useRef(false)
    const scrubSnapshot = useScrubSnapshot(scrub)
    const scrubPending = scrubSnapshot !== null && !scrubSnapshot.committed
    // Back while a target is pending only drops the target.
    useBackIntercept(scrubPending, () => {
        scrub?.cancel()
    })

    useTVEventHandler((event) => {
        if (!scrub || !visible || !event || !barFocusedRef.current) return
        const type = event.eventType
        const direction = type === "left" || type === "longLeft" ? -1 : type === "right" || type === "longRight" ? 1 : 0
        if (direction === 0) return

        // On the seek bar, presses and holds move the target; it is seeked once they stop.
        if (type === "longLeft" || type === "longRight") {
            if (tvKeyAction(event) === 0) scrub.hold(direction)
            else scrub.release()
            return
        }
        if (tvKeyAction(event) === 0) scrub.nudge(direction)
    })

    useTVEventHandler((event) => {
        if (scrub || !visible || !barFocused || !event) return
        if (tvKeyAction(event) === 0) return

        if (event.eventType === "left") {
            onSeekRelative(-seekSec)
            onControlFocus()
            return
        }
        if (event.eventType === "right") {
            onSeekRelative(seekSec)
            onControlFocus()
        }
    })

    React.useEffect(() => {
        if (!visible) {
            setBarFocused(false)
            barFocusedRef.current = false
            if (focusWhenHidden) returnRef.current = null
        }

        let frame = 0
        let tries = 0
        const run = () => {
            const target = visible
                // Controls brought up by scrubbing (webOS) open on the seek bar, so the next presses scrub too.
                ? scrub?.isPending()
                    ? barRef.current
                    : returnRef.current === "episodes"
                        ? episodesRef.current
                        : returnRef.current === "tracks"
                            ? tracksRef.current
                            : returnRef.current === "settings"
                                ? settingsRef.current
                                : playRef.current
                : focusWhenHidden
                    ? hiddenRef.current
                    : null

            // This is the reliable focus API on react-native-tvos. Retry while
            // the native focus tree settles after the player panel closes.
            requestTVFocus(target)
            tries++
            if (target && tries >= 5) returnRef.current = null
            if (tries < 5 && (visible || focusWhenHidden)) {
                frame = requestAnimationFrame(run)
            }
        }

        const timer = setTimeout(() => {
            if (visible) {
                run()
                return
            }
            if (focusWhenHidden) {
                run()
            }
        }, 50)

        return () => {
            clearTimeout(timer)
            if (frame) cancelAnimationFrame(frame)
        }
    }, [focusWhenHidden, scrub, visible])

    if (!visible) {
        if (!focusWhenHidden && !longSeekVisible) return null

        return (
            <>
                {focusWhenHidden ? (
                    <Pressable
                        ref={hiddenRef}
                        hasTVPreferredFocus
                        onPress={onShowControls}
                        accessibilityLabel="Show player controls"
                        style={Platform.OS === "web"
                            // Covers the video so a Magic Remote click anywhere brings the controls up.
                            ? { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, opacity: 0 }
                            : {
                                position: "absolute",
                                left: 0,
                                top: 0,
                                width: 1,
                                height: 1,
                                opacity: 0,
                            }}
                    />
                ) : null}
                {longSeekVisible ? (
                    <View
                        pointerEvents="none"
                        style={{
                            position: "absolute",
                            left: tvSize(68),
                            right: tvSize(68),
                            bottom: tvSize(54),
                            zIndex: 40,
                            gap: tvSize(9),
                        }}
                    >
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text
                                className="font-bold text-white"
                                style={{ fontSize: tvSize(19), fontVariant: ["tabular-nums"] }}
                            >
                                {formatTime(displayTime)}
                            </Text>
                            <Text
                                className="font-semibold text-white/60"
                                style={{ fontSize: tvSize(18), fontVariant: ["tabular-nums"] }}
                            >
                                {formatTime(state.duration)}
                            </Text>
                        </View>
                        <View
                            style={{
                                height: tvSize(9),
                                borderRadius: tvSize(5),
                                backgroundColor: "rgba(255,255,255,0.16)",
                                overflow: "hidden",
                            }}
                        >
                            <View
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: `${Math.max(0, Math.min(1, buffered)) * 100}%`,
                                    backgroundColor: BUFFER_FILL,
                                }}
                            />
                            <View
                                style={{
                                    width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
                                    height: "100%",
                                    borderRadius: tvSize(5),
                                    backgroundColor: "#ffffff",
                                }}
                            />
                        </View>
                    </View>
                ) : null}
            </>
        )
    }

    const title = source?.media?.title?.userPreferred
        ?? source?.media?.title?.english
        ?? "Now playing"
    const episode = source?.episode
        ? source.episode.displayTitle
        : `Episode ${source?.episodeNumber ?? ""}`.trim()
    const chapter = getChapter(chapters, displayTime)

    function run(action: () => void) {
        action()
        onControlAction()
    }

    if (Platform.OS === "web" && scrub) {
        const pendingTarget = scrubPending ? scrubSnapshot : null
        // Once seeked, the bar stays on the target until playback gets there.
        const settling = scrubSnapshot?.committed && !scrubSnapshot.relative ? scrubSnapshot : null
        const shownTime = settling ? settling.target : displayTime
        const shownProgress = settling && state.duration > 0 ? settling.target / state.duration : progress
        const isTorrentStream = source?.id.startsWith("torrentstream-") ?? false

        return (
            <TVOverlayFade>
                <View pointerEvents="none" style={FILL_STYLE} />
                <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(0,0,0,0.8)", "rgba(0,0,0,0)"]}
                    style={{ position: "absolute", top: 0, left: 0, right: 0, height: tvSize(280) }}
                />
                <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.9)"]}
                    locations={[0, 0.45, 1]}
                    style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: tvSize(500) }}
                />

                <TVPlayerExit onPress={onExit} onFocus={onControlFocus} />
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        top: tvSize(52),
                        left: tvSize(142),
                        right: tvSize(68),
                        flexDirection: "row",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                    }}
                >
                    {/* Margins, not gap: webOS 6 (Chromium 79) has no flexbox gap. */}
                    <View style={{ flexShrink: 1, marginRight: tvSize(32) }}>
                        <Text
                            className="font-black text-white"
                            style={{ fontSize: tvSize(34) }}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                        >
                            {title}
                        </Text>
                        <Text
                            className="font-medium text-white/65"
                            style={{ fontSize: tvSize(22), marginTop: tvSize(6) }}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                        >
                            {episode}
                        </Text>
                    </View>
                    {isTorrentStream ? <TVStreamTelemetry bufferedSeconds={state.cacheSeconds} /> : null}
                </View>

                <View
                    pointerEvents="box-none"
                    style={{
                        position: "absolute",
                        left: tvSize(80),
                        right: tvSize(80),
                        bottom: tvSize(26),
                    }}
                >
                    <Text
                        className="font-semibold text-white/75"
                        style={{ fontSize: tvSize(18), height: tvSize(26), opacity: pendingTarget ? 0 : 1 }}
                        numberOfLines={1}
                    >
                        {getChapter(chapters, shownTime)?.title ?? ""}
                    </Text>

                    <TVFocusGuideView trapFocusLeft trapFocusRight>
                        <TVScrubBar
                            barRef={barRef}
                            scrub={scrub}
                            snapshot={scrubSnapshot}
                            duration={state.duration}
                            progress={shownProgress}
                            buffered={buffered}
                            segments={segments}
                            chapters={chapters}
                            focused={barFocused}
                            accessibilityText={`${formatTime(pendingTarget && !pendingTarget.relative ? pendingTarget.target : shownTime)} of ${formatTime(state.duration)}`}
                            onFocus={() => {
                                barFocusedRef.current = true
                                setBarFocused(true)
                                onControlFocus()
                            }}
                            onBlur={() => {
                                barFocusedRef.current = false
                                setBarFocused(false)
                            }}
                            onPress={(event) => {
                                // Pointer clicks and drags seek from TVScrubBar's own handlers.
                                if (isPointerClick(event) && state.duration > 0) return
                                // OK seeks to a pending target at once, and otherwise plays and pauses.
                                if (scrub.commit()) {
                                    onControlAction()
                                    return
                                }
                                onTogglePlayPause()
                            }}
                            onPointerSeek={onControlAction}
                        />
                    </TVFocusGuideView>

                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: tvSize(4) }}>
                        <Text
                            className="font-bold text-white"
                            style={{ fontSize: tvSize(20), fontVariant: ["tabular-nums"] }}
                        >
                            {formatTime(shownTime)}
                        </Text>
                        <Text
                            className="font-semibold text-white/60"
                            style={{ fontSize: tvSize(20), fontVariant: ["tabular-nums"] }}
                        >
                            {formatTime(state.duration)}
                        </Text>
                    </View>

                    <TVFocusGuideView
                        autoFocus
                        destinations={playTarget ? [playTarget] : undefined}
                        trapFocusLeft
                        trapFocusRight
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginTop: tvSize(12),
                            // Room for the focused button's name under it.
                            paddingBottom: tvSize(44),
                        }}
                    >
                        <View style={[ROW_SIDE_STYLE, { justifyContent: "flex-end" }]}>
                            {canShowEpisodes ? (
                                <TVRoundControl
                                    ref={episodesRef}
                                    label="Episodes"
                                    icon={(color) => <List size={tvSize(30)} color={color} />}
                                    onPress={() => {
                                        returnRef.current = "episodes"
                                        onOpenEpisodes()
                                    }}
                                    onFocus={onControlFocus}
                                />
                            ) : null}
                            <TVRoundControl
                                ref={tracksRef}
                                label="Audio & subtitles"
                                icon={(color) => <Captions size={tvSize(30)} color={color} />}
                                onPress={() => {
                                    returnRef.current = "tracks"
                                    onOpenTracks()
                                }}
                                onFocus={onControlFocus}
                            />
                            <TVRoundControl
                                label={`Rewind ${seekSec}s`}
                                icon={(color) => <SeekIcon direction={-1} seconds={seekSec} color={color} />}
                                onPress={() => run(() => scrub.nudge(-1))}
                                onFocus={onControlFocus}
                            />
                        </View>
                        <View>
                            <TVRoundControl
                                ref={bindPlay}
                                label={state.paused ? "Play" : "Pause"}
                                icon={(color) => state.paused
                                    ? <Play size={tvSize(40)} color={color} fill={color} />
                                    : <Pause size={tvSize(40)} color={color} fill={color} />}
                                primary
                                preferOnMount={!scrubPending}
                                onPress={() => run(onTogglePlayPause)}
                                onFocus={onControlFocus}
                            />
                        </View>
                        <View style={[ROW_SIDE_STYLE, { justifyContent: "flex-start" }]}>
                            <TVRoundControl
                                label={`Forward ${seekSec}s`}
                                icon={(color) => <SeekIcon direction={1} seconds={seekSec} color={color} />}
                                onPress={() => run(() => scrub.nudge(1))}
                                onFocus={onControlFocus}
                            />
                            <TVRoundControl
                                label="Next episode"
                                icon={(color) => <SkipForward size={tvSize(30)} color={color} />}
                                disabled={!canPlayNext}
                                onPress={() => run(onPlayNext)}
                                onFocus={onControlFocus}
                            />
                            <TVRoundControl
                                ref={settingsRef}
                                label="Settings"
                                icon={(color) => <Settings size={tvSize(30)} color={color} />}
                                onPress={() => {
                                    returnRef.current = "settings"
                                    onOpenSettings()
                                }}
                                onFocus={onControlFocus}
                            />
                            {skipLabel && onSkip ? (
                                <TVSkipPill label={skipLabel} onPress={() => run(onSkip)} onFocus={onControlFocus} />
                            ) : null}
                        </View>
                    </TVFocusGuideView>
                </View>
            </TVOverlayFade>
        )
    }

    return (
        <View
            pointerEvents="box-none"
            style={{
                position: "absolute",
                inset: 0,
                zIndex: 40,
            }}
        >
            <View
                pointerEvents="none"
                style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(0,0,0,0.45)",
                }}
            />
            <TVPlayerExit onPress={onExit} onFocus={onControlFocus} />
            <View
                pointerEvents="none"
                style={{
                    position: "absolute",
                    top: tvSize(54),
                    left: tvSize(142),
                    right: tvSize(68),
                    gap: tvSize(6),
                }}
            >
                <Text
                    className="font-black text-white"
                    style={{ fontSize: tvSize(32), maxWidth: "75%" }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {title}
                </Text>
                <Text
                    className="font-medium text-white/60"
                    style={{ fontSize: tvSize(20), maxWidth: "75%" }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {episode}
                </Text>
            </View>

            <View
                style={{
                    position: "absolute",
                    left: tvSize(68),
                    right: tvSize(68),
                    bottom: tvSize(54),
                    gap: tvSize(18),
                }}
            >
                <View style={{ gap: tvSize(9) }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <Text
                            className="font-semibold text-white/75"
                            style={{ fontSize: tvSize(18) }}
                            numberOfLines={1}
                        >
                            {/*{barFocused
                                ? `Left / right to seek ${seekSec}s`
                                : chapter?.title ?? ""}*/}
                            {chapter?.title ?? ""}
                        </Text>
                        <Text
                            className="font-bold text-white"
                            style={{
                                fontSize: tvSize(19),
                                fontVariant: ["tabular-nums"],
                            }}
                        >
                            {formatTime(displayTime)}
                            <Text className="text-white/45"> / {formatTime(state.duration)}</Text>
                        </Text>
                    </View>

                    <TVFocusGuideView trapFocusLeft trapFocusRight>
                        <Pressable
                            onPress={(event) => {
                                // A pointer click seeks to that spot; OK still plays and pauses.
                                const fraction = onSeekTo && state.duration > 0 ? pointerFraction(event) : null
                                if (fraction === null) {
                                    onTogglePlayPause()
                                    return
                                }
                                onSeekTo!(fraction * state.duration)
                                onControlAction()
                            }}
                            onFocus={() => {
                                setBarFocused(true)
                                onControlFocus()
                            }}
                            onBlur={() => setBarFocused(false)}
                            accessibilityRole="adjustable"
                            accessibilityLabel="Playback timeline"
                            accessibilityValue={{
                                min: 0,
                                max: Math.max(0, Math.round(state.duration)),
                                now: Math.max(0, Math.round(displayTime)),
                                text: `${formatTime(displayTime)} of ${formatTime(state.duration)}`,
                            }}
                            style={{
                                height: tvSize(38),
                                justifyContent: "center",
                            }}
                        >
                            <View
                                style={{
                                    height: tvSize(barFocused ? 11 : 7),
                                    flexDirection: "row",
                                    gap: tvSize(3),
                                }}
                            >
                                {segments.map((segment, index) => {
                                    const ratio = segment.endProgress <= segment.startProgress
                                        ? 0
                                        : Math.max(0, Math.min(
                                            1,
                                            (progress - segment.startProgress)
                                            / (segment.endProgress - segment.startProgress),
                                        ))
                                    const bufferedRatio = segment.endProgress <= segment.startProgress
                                        ? 0
                                        : Math.max(0, Math.min(
                                            1,
                                            (buffered - segment.startProgress)
                                            / (segment.endProgress - segment.startProgress),
                                        ))
                                    return (
                                    <View
                                        key={`${segment.id}-${index}`}
                                        style={{
                                            flexGrow: segment.duration,
                                            flexShrink: 1,
                                            flexBasis: 0,
                                            height: "100%",
                                            borderRadius: tvSize(4),
                                            backgroundColor: isSkippableChapter(segment.title)
                                                ? "rgba(147,197,253,0.45)"
                                                : "rgba(255,255,255,0.2)",
                                            overflow: "hidden",
                                        }}
                                    >
                                        <View
                                            style={{
                                                position: "absolute",
                                                left: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: `${bufferedRatio * 100}%`,
                                                borderRadius: tvSize(4),
                                                backgroundColor: BUFFER_FILL,
                                            }}
                                        />
                                        <View
                                            style={{
                                                width: `${ratio * 100}%`,
                                                height: "100%",
                                                borderRadius: tvSize(4),
                                                backgroundColor: "#ffffff",
                                            }}
                                        />
                                    </View>
                                    )
                                })}
                            </View>
                            {barFocused ? (
                                <View
                                    pointerEvents="none"
                                    style={{
                                        position: "absolute",
                                        left: `${Math.max(0, Math.min(1, progress)) * 100}%`,
                                        top: "50%",
                                        width: tvSize(20),
                                        height: tvSize(20),
                                        marginLeft: -tvSize(10),
                                        marginTop: -tvSize(10),
                                        borderRadius: tvSize(10),
                                        borderWidth: tvSize(3),
                                        borderColor: FOCUS_BORDER,
                                        backgroundColor: "#ffffff",
                                    }}
                                />
                            ) : null}
                        </Pressable>
                    </TVFocusGuideView>
                </View>

                <TVFocusGuideView
                    autoFocus
                    destinations={playTarget ? [playTarget] : undefined}
                    trapFocusLeft
                    trapFocusRight
                    style={{
                        padding: tvSize(8),
                        margin: -tvSize(8),
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: tvSize(18),
                    }}
                >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(12) }}>
                        <TVPlayerControl
                            label={`${seekSec}s`}
                            icon={(color) => <RotateCcw size={tvSize(23)} color={color} />}
                            onPress={() => run(() => onSeekRelative(-seekSec))}
                            onFocus={onControlFocus}
                        />
                        <TVPlayerControl
                            ref={bindPlay}
                            label={state.paused ? "Play" : "Pause"}
                            icon={(color) => state.paused
                                ? <Play size={tvSize(27)} color={color} fill={color} />
                                : <Pause size={tvSize(27)} color={color} fill={color} />}
                            primary
                            preferred
                            onPress={() => run(onTogglePlayPause)}
                            onFocus={onControlFocus}
                        />
                        <TVPlayerControl
                            label={`${seekSec}s`}
                            icon={(color) => <RotateCw size={tvSize(23)} color={color} />}
                            onPress={() => run(() => onSeekRelative(seekSec))}
                            onFocus={onControlFocus}
                        />
                        <TVPlayerControl
                            label="Next"
                            icon={(color) => <SkipForward size={tvSize(23)} color={color} />}
                            disabled={!canPlayNext}
                            onPress={() => run(onPlayNext)}
                            onFocus={onControlFocus}
                        />
                        {skipLabel && onSkip ? (
                            <TVPlayerControl
                                label={skipLabel}
                                icon={(color) => <SkipForward size={tvSize(22)} color={color} />}
                                onPress={() => run(onSkip)}
                                onFocus={onControlFocus}
                            />
                        ) : null}
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(12) }}>
                        {canShowEpisodes ? (
                            <TVPlayerControl
                                ref={episodesRef}
                                label="Episodes"
                                icon={(color) => <List size={tvSize(22)} color={color} />}
                                onPress={() => {
                                    returnRef.current = "episodes"
                                    onOpenEpisodes()
                                }}
                                onFocus={onControlFocus}
                            />
                        ) : null}
                        <TVPlayerControl
                            ref={tracksRef}
                            label="Audio & subtitles"
                            wide
                            icon={(color) => <Captions size={tvSize(22)} color={color} />}
                            onPress={() => {
                                returnRef.current = "tracks"
                                onOpenTracks()
                            }}
                            onFocus={onControlFocus}
                        />
                        <TVPlayerControl
                            ref={settingsRef}
                            label="Settings"
                            icon={(color) => <Settings size={tvSize(22)} color={color} />}
                            onPress={() => {
                                returnRef.current = "settings"
                                onOpenSettings()
                            }}
                            onFocus={onControlFocus}
                        />
                    </View>
                </TVFocusGuideView>
            </View>
        </View>
    )
}

///////////////////////////////////////////////////////////////////////////////
// webOS layout: YouTube TV-style controls
///////////////////////////////////////////////////////////////////////////////

const FILL_STYLE = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.16)",
} as const

/** Space between the round buttons, as margins (webOS 6 has no flexbox gap). */
const ROW_GAP = tvSize(22)
const ROW_SIDE_STYLE = {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
} as const

/** Icons on a focused (white) button. */
const FOCUSED_ICON = "#0b0b0b"

/** How often a pointer drag on the timeline moves the preview, at most. */
const POINTER_PREVIEW_MS = 50

/** The controls fade in; the Web Animations API runs it on the compositor (Chromium 79 has it). */
function TVOverlayFade({ children }: { children: React.ReactNode }) {
    const ref = React.useRef<React.ComponentRef<typeof View>>(null)

    React.useEffect(() => {
        const node = ref.current as unknown as HTMLElement | null
        if (typeof node?.animate !== "function") return
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" })
    }, [])

    return (
        <View
            ref={ref}
            pointerEvents="box-none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
        >
            {children}
        </View>
    )
}

type RoundControlProps = {
    label: string
    icon: (color: string) => React.ReactNode
    onPress: () => void
    /** Play/pause: the biggest button, in the middle. */
    primary?: boolean
    /** Takes focus when it mounts; decided once, so it never pulls focus off the seek bar later. */
    preferOnMount?: boolean
    disabled?: boolean
    onFocus?: () => void
}

/** A round button that turns white when focused and shows its name under it. */
const TVRoundControl = React.forwardRef<PressableRef, RoundControlProps>(
    ({ label, icon, onPress, primary, preferOnMount, disabled, onFocus }, ref) => {
        const focus = useTVFocus(1.08)
        const [preferred] = React.useState(Boolean(preferOnMount))
        const diameter = tvSize(primary ? 96 : 80)

        return (
            <Pressable
                ref={ref}
                onPress={onPress}
                disabled={disabled}
                hasTVPreferredFocus={preferred}
                onFocus={() => {
                    focus.focus()
                    onFocus?.()
                }}
                onBlur={focus.blur}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled: Boolean(disabled) }}
                style={{
                    width: diameter,
                    height: diameter,
                    marginHorizontal: ROW_GAP / 2,
                    flexShrink: 0,
                    opacity: disabled ? 0.35 : 1,
                }}
            >
                <TVFocusScaleView
                    style={[
                        focus.style,
                        {
                            width: diameter,
                            height: diameter,
                            borderRadius: diameter / 2,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: focus.focused
                                ? "#ffffff"
                                : primary
                                    ? "rgba(255,255,255,0.22)"
                                    : "rgba(255,255,255,0.12)",
                        },
                    ]}
                >
                    {icon(focus.focused ? FOCUSED_ICON : "#ffffff")}
                </TVFocusScaleView>
                {focus.focused ? (
                    // Wider than the button; a single-line Text can't outgrow its parent on the web.
                    <View
                        pointerEvents="none"
                        style={{
                            position: "absolute",
                            top: diameter + tvSize(12),
                            left: -tvSize(100),
                            right: -tvSize(100),
                            alignItems: "center",
                        }}
                    >
                        <Text
                            className="font-semibold text-white"
                            numberOfLines={1}
                            style={{ textAlign: "center", fontSize: tvSize(18) }}
                        >
                            {label}
                        </Text>
                    </View>
                ) : null}
            </Pressable>
        )
    },
)

TVRoundControl.displayName = "TVRoundControl"

/** Skip intro / outro: a pill with its name always showing, at the end of the row. */
function TVSkipPill({ label, onPress, onFocus }: { label: string; onPress: () => void; onFocus: () => void }) {
    const focus = useTVFocus(1.06)
    const color = focus.focused ? FOCUSED_ICON : "#ffffff"

    return (
        <Pressable
            onPress={onPress}
            onFocus={() => {
                focus.focus()
                onFocus()
            }}
            onBlur={focus.blur}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={{ flexShrink: 0, marginLeft: ROW_GAP / 2 + tvSize(10) }}
        >
            <TVFocusScaleView
                style={[
                    focus.style,
                    {
                        height: tvSize(64),
                        paddingHorizontal: tvSize(26),
                        borderRadius: tvSize(32),
                        borderWidth: tvSize(2),
                        borderColor: focus.focused ? "#ffffff" : "rgba(255,255,255,0.55)",
                        backgroundColor: focus.focused ? "#ffffff" : "rgba(0,0,0,0.35)",
                        flexDirection: "row",
                        alignItems: "center",
                    },
                ]}
            >
                <SkipForward size={tvSize(24)} color={color} />
                <Text className="font-bold" style={{ color, fontSize: tvSize(20), marginLeft: tvSize(10) }}>{label}</Text>
            </TVFocusScaleView>
        </Pressable>
    )
}

/** Rewind / forward: a circular arrow with the step inside, as on YouTube. */
function SeekIcon({ direction, seconds, color }: { direction: -1 | 1; seconds: number; color: string }) {
    const size = tvSize(38)
    const Icon = direction < 0 ? RotateCcw : RotateCw

    return (
        <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
            <Icon size={size} color={color} />
            <Text
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: size,
                    lineHeight: size,
                    textAlign: "center",
                    color,
                    fontSize: tvSize(12),
                    fontWeight: "800",
                }}
            >
                {seconds}
            </Text>
        </View>
    )
}

type Segment = ReturnType<typeof getSegments>[number]

type ScrubBarProps = {
    barRef: React.MutableRefObject<PressableRef | null>
    scrub: ScrubController
    snapshot: ScrubSnapshot | null
    duration: number
    /** Played share, 0 to 1 (the committed target while a seek lands). */
    progress: number
    buffered: number
    segments: Segment[]
    chapters: PlayerChapter[]
    focused: boolean
    accessibilityText: string
    onFocus: () => void
    onBlur: () => void
    onPress: (event: GestureResponderEvent) => void
    /** A pointer click or drag seeked. */
    onPointerSeek: () => void
}

/**
 * The webOS seek bar. A pending target shows as a thumb with its time and
 * offset above it, and the stretch between it and playback is lit. With the
 * Magic Remote pointer, pressing on the bar previews that spot, dragging
 * moves the preview, and letting go seeks there (a click is a press and a
 * release in one place).
 */
function TVScrubBar({
    barRef,
    scrub,
    snapshot,
    duration,
    progress,
    buffered,
    segments,
    chapters,
    focused,
    accessibilityText,
    onFocus,
    onBlur,
    onPress,
    onPointerSeek,
}: ScrubBarProps) {
    const nodeRef = React.useRef<PressableRef | null>(null)
    const [width, setWidth] = React.useState(0)
    const durationRef = React.useRef(duration)
    durationRef.current = duration
    const onPointerSeekRef = React.useRef(onPointerSeek)
    onPointerSeekRef.current = onPointerSeek

    const setRef = React.useCallback((node: PressableRef | null) => {
        nodeRef.current = node
        barRef.current = node
    }, [barRef])

    React.useEffect(() => {
        const node = nodeRef.current as unknown as HTMLElement | null
        if (Platform.OS !== "web" || typeof node?.addEventListener !== "function") return

        let dragging = false
        let lastX = 0
        let timer: ReturnType<typeof setTimeout> | null = null

        const previewAt = (clientX: number) => {
            const box = node.getBoundingClientRect()
            const total = durationRef.current
            if (box.width <= 0 || !(total > 0)) return
            scrub.preview(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * total)
        }
        const flush = () => {
            timer = null
            previewAt(lastX)
        }
        const stop = () => {
            dragging = false
            window.removeEventListener("mousemove", onMove, true)
            window.removeEventListener("mouseup", onUp, true)
            if (timer !== null) clearTimeout(timer)
            timer = null
        }
        const finish = () => {
            if (!dragging) return
            stop()
            previewAt(lastX)
            if (scrub.commit()) onPointerSeekRef.current()
        }
        function onMove(event: MouseEvent) {
            // The release happened where we didn't see it.
            if ((event.buttons & 1) === 0) {
                finish()
                return
            }
            lastX = event.clientX
            if (timer === null) timer = setTimeout(flush, POINTER_PREVIEW_MS)
        }
        function onUp(event: MouseEvent) {
            if (event.button === 0) finish()
        }
        const onDown = (event: MouseEvent) => {
            if (event.button !== 0 || dragging || !(durationRef.current > 0)) return
            dragging = true
            lastX = event.clientX
            previewAt(lastX)
            window.addEventListener("mousemove", onMove, true)
            window.addEventListener("mouseup", onUp, true)
        }

        node.addEventListener("mousedown", onDown)
        return () => {
            node.removeEventListener("mousedown", onDown)
            stop()
        }
    }, [scrub])

    const pending = snapshot !== null && !snapshot.committed ? snapshot : null
    const clampedProgress = Math.max(0, Math.min(1, progress))
    const targetProgress = pending && !pending.relative && duration > 0
        ? Math.max(0, Math.min(1, pending.target / duration))
        : null
    const trackHeight = tvSize(focused || pending ? 12 : 8)
    const thumb = targetProgress ?? clampedProgress
    const thumbSize = tvSize(pending ? 28 : 24)
    const bubbleWidth = tvSize(180)
    const bubbleLeft = width > 0
        ? Math.max(0, Math.min(width - bubbleWidth, thumb * width - bubbleWidth / 2))
        : 0
    const targetChapter = targetProgress !== null && chapters.length > 1
        ? getChapter(chapters, pending!.target)?.title
        : undefined

    return (
        <Pressable
            ref={setRef}
            onPress={onPress}
            onFocus={onFocus}
            onBlur={onBlur}
            accessibilityRole="adjustable"
            accessibilityLabel="Playback timeline"
            accessibilityValue={{
                min: 0,
                max: Math.max(0, Math.round(duration)),
                now: Math.max(0, Math.round(thumb * duration)),
                text: accessibilityText,
            }}
            style={{ height: tvSize(44), justifyContent: "center" }}
        >
            <View
                onLayout={(event) => {
                    const next = event.nativeEvent.layout.width
                    setWidth(current => current === next ? current : next)
                }}
                style={{ height: trackHeight, flexDirection: "row" }}
            >
                {segments.map((segment, index) => {
                    const span = segment.endProgress - segment.startProgress
                    const played = span <= 0 ? 0 : Math.max(0, Math.min(1, (clampedProgress - segment.startProgress) / span))
                    const loaded = span <= 0 ? 0 : Math.max(0, Math.min(1, (buffered - segment.startProgress) / span))
                    return (
                        <View
                            key={`${segment.id}-${index}`}
                            style={{
                                flexGrow: segment.duration,
                                flexShrink: 1,
                                flexBasis: 0,
                                // Chapter breaks; a margin, as webOS 6 has no flexbox gap.
                                marginLeft: index > 0 ? tvSize(3) : 0,
                                height: "100%",
                                borderRadius: tvSize(6),
                                backgroundColor: isSkippableChapter(segment.title)
                                    ? "rgba(147,197,253,0.45)"
                                    : "rgba(255,255,255,0.22)",
                                overflow: "hidden",
                            }}
                        >
                            <View
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: `${loaded * 100}%`,
                                    backgroundColor: BUFFER_FILL,
                                }}
                            />
                            <View style={{ width: `${played * 100}%`, height: "100%", backgroundColor: "#ffffff" }} />
                        </View>
                    )
                })}
            </View>

            {targetProgress !== null ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        left: `${Math.min(targetProgress, clampedProgress) * 100}%`,
                        width: `${Math.abs(targetProgress - clampedProgress) * 100}%`,
                        top: "50%",
                        height: trackHeight,
                        marginTop: -trackHeight / 2,
                        borderRadius: tvSize(6),
                        backgroundColor: "rgba(255,255,255,0.55)",
                    }}
                />
            ) : null}

            {focused || pending ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        left: `${thumb * 100}%`,
                        top: "50%",
                        width: thumbSize,
                        height: thumbSize,
                        marginLeft: -thumbSize / 2,
                        marginTop: -thumbSize / 2,
                        borderRadius: thumbSize / 2,
                        backgroundColor: "#ffffff",
                        borderWidth: tvSize(3),
                        borderColor: "rgba(0,0,0,0.35)",
                    }}
                />
            ) : null}

            {pending ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        bottom: tvSize(42),
                        left: bubbleLeft,
                        width: bubbleWidth,
                        alignItems: "center",
                        paddingVertical: tvSize(10),
                        paddingHorizontal: tvSize(12),
                        borderRadius: tvSize(14),
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.16)",
                        backgroundColor: "rgba(14,14,14,0.92)",
                    }}
                >
                    {pending.relative ? null : (
                        <Text
                            className="font-bold text-white"
                            style={{ fontSize: tvSize(28), fontVariant: ["tabular-nums"] }}
                        >
                            {formatTime(pending.target)}
                        </Text>
                    )}
                    <Text
                        className="font-semibold text-white/75"
                        style={{ fontSize: tvSize(19), fontVariant: ["tabular-nums"] }}
                    >
                        {formatScrubOffset(pending.offset)}
                    </Text>
                    {targetChapter ? (
                        <Text
                            className="font-medium text-white/55"
                            style={{ fontSize: tvSize(15), marginTop: tvSize(2), maxWidth: "100%" }}
                            numberOfLines={1}
                        >
                            {targetChapter}
                        </Text>
                    ) : null}
                </View>
            ) : null}
        </Pressable>
    )
}

function getChapter(chapters: PlayerChapter[], time: number) {
    let current: PlayerChapter | undefined
    for (const chapter of chapters) {
        if (chapter.start > time) break
        current = chapter
    }
    return current
}

function getSegments(chapters: PlayerChapter[], duration: number) {
    const total = Math.max(duration, 1)
    if (chapters.length === 0) {
        return [{
            id: 0,
            title: undefined as string | undefined,
            duration: total,
            startProgress: 0,
            endProgress: 1,
        }]
    }

    const sorted = [...chapters].sort((a, b) => a.start - b.start)
    return sorted.map((chapter, index) => {
        const start = index === 0 ? 0 : chapter.start
        const end = Math.max(start, sorted[index + 1]?.start ?? total)
        return {
            id: chapter.id,
            title: chapter.title,
            duration: Math.max(0.1, end - start),
            startProgress: Math.max(0, Math.min(1, start / total)),
            endProgress: Math.max(0, Math.min(1, end / total)),
        }
    })
}
