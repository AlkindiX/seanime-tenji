import { TVButton, TVPillButton } from "@/components/tv/tv-focus"
import { TVScoreBadge } from "@/components/tv/tv-score-badge"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { TVHeroSkeleton } from "@/components/tv/tv-skeleton"
import { Ionicons } from "@/lib/icons/Ionicons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { Platform, Pressable, Text, TVFocusGuideView, View } from "react-native"

const ROTATE_MS = 10000
/** Backdrop cross-fade; the text eases in over the first part of it. */
const FADE_MS = 900
const TEXT_MS = 480
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)"
const BRAND = "#8176ef"

export type TVHeroItem = {
    key: string
    image?: string
    kicker?: string
    title: string
    subtitle?: string
    meta?: string
    description?: string
    score?: number
    /** Watched share of the episode the action plays (0-100). */
    progressPercent?: number
    /** Shown next to the progress meter, e.g. "12m left". */
    progressLabel?: string
    actionLabel: string
    onAction: () => void
    secondaryLabel?: string
    onSecondary?: () => void
}

type Props = {
    items: TVHeroItem[]
    active?: boolean
    preferred?: boolean
    height?: number
    loading?: boolean
}

type ViewNode = React.ComponentRef<typeof View>

/**
 * Web Animations on opacity and transform: the TV's compositor runs them.
 * Native TV builds switch slides without them.
 */
function animate(view: ViewNode | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    if (Platform.OS !== "web") return null
    const node = view as unknown as HTMLElement | null
    return node && typeof node.animate === "function" ? node.animate(keyframes, options) : null
}

function prefetch(uri: string | undefined) {
    if (uri) void Image.prefetch(uri).catch(() => undefined)
}

export const TVHeroCarousel = React.memo(function TVHeroCarousel({
    items,
    active = true,
    preferred,
    height = tvSize(560),
    loading = false,
}: Props) {
    // The slide on screen, by key: when the items change (webOS: trending arrives
    // after continue watching, a refetch reorders them) the hero stays on that
    // slide, wherever it now is, and starts over at the first only when it is gone.
    const [slideKey, setSlideKey] = React.useState<string | null>(null)
    const [firstAction, setFirstAction] = React.useState<React.ElementRef<typeof Pressable> | null>(null)
    // Rotation waits while focus is on the hero's buttons, so they don't change under it.
    const [focusInside, setFocusInside] = React.useState(false)
    const containerRef = React.useRef<ViewNode>(null)
    const textRef = React.useRef<ViewNode>(null)
    const keys = items.map(item => item.key).join(":")
    const count = items.length
    const index = slideKey === null ? 0 : Math.max(items.findIndex(item => item.key === slideKey), 0)
    const nextKey = count > 1 ? items[(index + 1) % count].key : null
    const rotating = active && count > 1 && !focusInside

    // Android TV and tvOS start over at the first slide whenever the items change, as before.
    React.useEffect(() => {
        if (Platform.OS !== "web") setSlideKey(null)
    }, [keys])

    const move = React.useCallback((next: number) => {
        if (count <= 1) return
        setSlideKey(items[(next + count) % count].key)
    }, [count, items])

    // One timer per slide: a manual change starts the wait over.
    React.useEffect(() => {
        if (!rotating || nextKey === null) return
        const timer = setTimeout(() => setSlideKey(nextKey), ROTATE_MS)
        return () => clearTimeout(timer)
    }, [index, nextKey, rotating])

    React.useEffect(() => {
        if (Platform.OS !== "web") return
        const node = containerRef.current as unknown as HTMLElement | null
        if (!node) return
        const onIn = () => setFocusInside(true)
        const onOut = (event: FocusEvent) => {
            if (!(event.relatedTarget instanceof Node) || !node.contains(event.relatedTarget)) setFocusInside(false)
        }
        node.addEventListener("focusin", onIn)
        node.addEventListener("focusout", onOut)
        return () => {
            node.removeEventListener("focusin", onIn)
            node.removeEventListener("focusout", onOut)
        }
    }, [count > 0])

    const item = count > 0 ? items[index] : null

    // The next backdrop is decoded before its turn, so the cross-fade doesn't stall on it.
    React.useEffect(() => {
        if (count > 1) prefetch(items[(index + 1) % count]?.image)
    }, [count, index, items])

    // The text eases in with each slide (it stays mounted: its buttons may hold focus).
    const shownKey = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (!item) return
        const first = shownKey.current === null
        shownKey.current = item.key
        if (first) return
        animate(textRef.current, [
            { opacity: 0, transform: `translateY(${tvSize(18)}px)` },
            { opacity: 1, transform: "translateY(0px)" },
        ], { duration: TEXT_MS, easing: EASE_OUT })
    }, [item?.key])

    if (!item) {
        return loading ? <TVHeroSkeleton height={height} /> : null
    }

    const progress = Math.min(Math.max(item.progressPercent ?? 0, 0), 100)

    return (
        <View ref={containerRef} style={{ height, overflow: "hidden", backgroundColor: "#121212" }}>
            <HeroBackdrop itemKey={item.key} image={item.image} />
            <LinearGradient
                colors={["rgba(10,10,10,0.97)", "rgba(10,10,10,0.62)", "rgba(10,10,10,0.08)"]}
                locations={[0, 0.5, 1]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={{ position: "absolute", inset: 0 }}
            />
            <LinearGradient
                colors={["transparent", "rgba(10,10,10,0.3)", "#0a0a0a"]}
                locations={[0, 0.7, 1]}
                style={{ position: "absolute", inset: 0 }}
            />

            {/* Anchored to the bottom: the buttons stay put whatever the title and text lengths. */}
            <View
                style={{
                    position: "absolute",
                    top: TV.navInset,
                    bottom: tvSize(64),
                    left: 0,
                    width: "62%",
                    paddingHorizontal: TV.gutter,
                    justifyContent: "flex-end",
                    gap: tvSize(18),
                }}
            >
                <View ref={textRef} style={{ gap: tvSize(10) }}>
                    <Text
                        className="font-black text-white"
                        style={{ fontSize: tvSize(52), lineHeight: tvSize(58) }}
                        numberOfLines={2}
                    >
                        {item.title}
                    </Text>
                    {item.subtitle || progress > 0 ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(16) }}>
                            {item.subtitle ? (
                                <Text
                                    className="font-semibold text-white/90"
                                    style={{ fontSize: tvSize(24), flexShrink: 1 }}
                                    numberOfLines={1}
                                >
                                    {item.subtitle}
                                </Text>
                            ) : null}
                            {progress > 0 ? <HeroProgress percent={progress} label={item.progressLabel} /> : null}
                        </View>
                    ) : null}
                    {item.score || item.meta ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(12) }}>
                            {item.score ? <TVScoreBadge score={item.score} kind="audience" /> : null}
                            {item.meta ? (
                                <Text className="font-medium text-white/60" style={{ fontSize: tvSize(20) }} numberOfLines={1}>
                                    {item.meta}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                    {item.description ? (
                        <Text
                            className="text-white/60"
                            style={{ fontSize: tvSize(21), lineHeight: tvSize(30), maxWidth: tvSize(860) }}
                            numberOfLines={2}
                        >
                            {item.description}
                        </Text>
                    ) : null}
                </View>

                <TVFocusGuideView
                    autoFocus={active}
                    destinations={firstAction ? [firstAction] : undefined}
                    trapFocusLeft
                    trapFocusRight
                    style={{ flexDirection: "row", alignItems: "center", gap: tvSize(14) }}
                >
                    <TVButton
                        ref={setFirstAction}
                        label={item.actionLabel}
                        variant="primary"
                        size="compact"
                        preferred={preferred && active}
                        icon={<Ionicons name="play" size={tvSize(22)} color="white" />}
                        onPress={item.onAction}
                    />
                    {item.secondaryLabel && item.onSecondary ? (
                        <TVButton
                            label={item.secondaryLabel}
                            variant="secondary"
                            size="compact"
                            icon={<Ionicons name="information-circle-outline" size={tvSize(24)} color="white" />}
                            onPress={item.onSecondary}
                        />
                    ) : null}
                    {count > 1 ? (
                        <>
                            <TVPillButton
                                label=""
                                accessibilityLabel="Previous featured title"
                                onPress={() => move(index - 1)}
                                icon={(focused) => (
                                    <Ionicons name="chevron-back" size={tvSize(22)} color={focused ? "#000000" : "#ffffff"} />
                                )}
                            />
                            <TVPillButton
                                label=""
                                accessibilityLabel="Next featured title"
                                onPress={() => move(index + 1)}
                                icon={(focused) => (
                                    <Ionicons name="chevron-forward" size={tvSize(22)} color={focused ? "#000000" : "#ffffff"} />
                                )}
                            />
                        </>
                    ) : null}
                </TVFocusGuideView>
            </View>

            {count > 1 ? (
                <HeroPager count={count} index={index} keys={items.map(hero => hero.key)} running={rotating} />
            ) : null}
        </View>
    )
})

/**
 * The backdrop: the incoming image fades in over the outgoing one while
 * settling from a slight zoom, then the outgoing one is dropped.
 */
function HeroBackdrop({ itemKey, image }: { itemKey: string; image?: string }) {
    const [layers, setLayers] = React.useState<{ key: string; image?: string }[]>([{ key: itemKey, image }])

    React.useEffect(() => {
        setLayers((current) => {
            const top = current[current.length - 1]
            if (top?.key === itemKey && top.image === image) return current
            return top ? [top, { key: itemKey, image }] : [{ key: itemKey, image }]
        })
    }, [image, itemKey])

    const settle = React.useCallback((key: string) => {
        setLayers(current => current.length > 1 && current[current.length - 1].key === key ? current.slice(-1) : current)
    }, [])

    return (
        <>
            {layers.map((layer, position) => (
                <BackdropLayer
                    key={layer.key}
                    image={layer.image}
                    entering={layers.length > 1 && position === layers.length - 1}
                    onEntered={() => settle(layer.key)}
                />
            ))}
        </>
    )
}

function BackdropLayer({ image, entering, onEntered }: { image?: string; entering: boolean; onEntered: () => void }) {
    const ref = React.useRef<ViewNode>(null)
    const done = React.useRef(onEntered)
    done.current = onEntered

    React.useEffect(() => {
        if (!entering) return
        const animation = animate(ref.current, [
            { opacity: 0, transform: "scale(1.06)" },
            { opacity: 1, transform: "scale(1)" },
        ], { duration: FADE_MS, easing: EASE_OUT })
        if (!animation) {
            done.current()
            return
        }
        animation.onfinish = () => done.current()
        return () => animation.cancel()
    }, [entering])

    return (
        <View ref={ref} pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
            {image ? (
                <Image
                    source={{ uri: image }}
                    style={{ position: "absolute", inset: 0 }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    priority="high"
                    transition={entering ? 0 : 200}
                />
            ) : null}
        </View>
    )
}

/** Watch progress of the episode the hero plays: a short meter with what's left. */
function HeroProgress({ percent, label }: { percent: number; label?: string }) {
    return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(10), flexShrink: 0 }}>
            <View
                style={{
                    width: tvSize(132),
                    height: tvSize(6),
                    borderRadius: tvSize(3),
                    overflow: "hidden",
                    backgroundColor: "rgba(255,255,255,0.18)",
                }}
            >
                <View style={{ width: `${percent}%`, height: "100%", borderRadius: tvSize(3), backgroundColor: BRAND }} />
            </View>
            <Text className="font-semibold text-white/70" style={{ fontSize: tvSize(18) }} numberOfLines={1}>
                {label ?? `${Math.round(percent)}% watched`}
            </Text>
        </View>
    )
}

/**
 * Page dots; the current one fills up over the time until the next slide
 * (and stays full while rotation waits for focus to leave the hero).
 */
function HeroPager({ count, index, keys, running }: { count: number; index: number; keys: string[]; running: boolean }) {
    const fillRef = React.useRef<ViewNode>(null)

    React.useEffect(() => {
        if (!running) return
        const animation = animate(fillRef.current, [
            { transform: "scaleX(0)" },
            { transform: "scaleX(1)" },
        ], { duration: ROTATE_MS, easing: "linear" })
        return () => animation?.cancel()
    }, [index, running])

    return (
        <View
            pointerEvents="none"
            style={{
                position: "absolute",
                right: TV.gutter,
                bottom: tvSize(28),
                flexDirection: "row",
                alignItems: "center",
                gap: tvSize(7),
            }}
        >
            {keys.map((key, dot) => (
                <View
                    key={key}
                    style={[{
                        width: tvSize(dot === index ? 40 : 10),
                        height: tvSize(4),
                        borderRadius: tvSize(2),
                        overflow: "hidden",
                        backgroundColor: dot === index ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.25)",
                    }, Platform.OS === "web" ? DOT_TRANSITION : null]}
                >
                    {dot === index ? (
                        <View ref={fillRef} style={{ width: "100%", height: "100%", backgroundColor: "#ffffff", transformOrigin: "left" }} />
                    ) : null}
                </View>
            ))}
            <Text className="font-semibold text-white/40" style={{ marginLeft: tvSize(6), fontSize: tvSize(16) }}>
                {index + 1}/{count}
            </Text>
        </View>
    )
}

/** Dots grow and shrink smoothly (a CSS transition, webOS only). */
const DOT_TRANSITION = { transitionProperty: "width", transitionDuration: "320ms", transitionTimingFunction: EASE_OUT } as object
