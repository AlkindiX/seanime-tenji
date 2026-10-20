import { TV, tvSize } from "@/components/tv/tv-scale"
import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { Platform, View } from "react-native"
import Animated, { Extrapolation, interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated"

/**
 * A dark fade at the top of a tab screen, so rows scrolled up under the
 * floating nav bar sink into the background instead of running into it.
 * Android TV draws this with the ScrollView's `fadingEdgeLength`, which the
 * web ignores, so it's webOS only. Render it inside the screen, after the
 * scrolling content and before anything that must stay on top.
 *
 * With `scrollY` (a screen whose top is a hero image) it fades in as the
 * screen scrolls; without, it is always there.
 */
export function TVNavScrim({ scrollY }: { scrollY?: SharedValue<number> }) {
    if (Platform.OS !== "web") return null
    return scrollY ? <ScrollingScrim scrollY={scrollY} /> : <View pointerEvents="none" style={SCRIM_STYLE}><Gradient /></View>
}

const SCRIM_STYLE = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: TV.navInset + tvSize(40),
    zIndex: 205,
} as const

function Gradient() {
    return (
        <LinearGradient
            colors={["rgba(10,10,10,0.97)", "rgba(10,10,10,0.85)", "rgba(10,10,10,0)"]}
            locations={[0, 0.55, 1]}
            style={{ flex: 1 }}
        />
    )
}

function ScrollingScrim({ scrollY }: { scrollY: SharedValue<number> }) {
    const style = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [tvSize(40), tvSize(160)], [0, 1], Extrapolation.CLAMP),
    }))
    return (
        <Animated.View pointerEvents="none" style={[SCRIM_STYLE, style]}>
            <Gradient />
        </Animated.View>
    )
}
