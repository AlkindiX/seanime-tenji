import { tvSize } from "@/components/tv/tv-scale"
import * as React from "react"
import { Platform, View } from "react-native"

/**
 * Screen transitions for the webOS TV build.
 *
 * Expo Router's stacks and tabs switch screens instantly on the web. Stacks
 * get a `screenLayout` that wraps each screen; tabs (whose navigator takes no
 * `screenLayout`) animate the container showing the current tab. Either way,
 * the screen coming in plays a short entrance with the
 * Web Animations API on opacity and transform only, which the TV's
 * compositor runs without JavaScript per frame. Exits aren't animated: the
 * navigator removes or hides the old screen at once, and holding it back
 * would delay every navigation.
 */

type ScreenLayoutProps = {
    route: { name: string; key: string }
    navigation: {
        addListener: (type: "focus", callback: () => void) => () => void
        getState: () => { routes: readonly { key: string }[]; index: number }
    }
    children: React.ReactNode
}

const ENABLED = Platform.OS === "web"
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

/** The TV nav bar's order, so a tab slides in from the side it lies on. */
const TAB_ORDER = ["(library)", "discover", "my-lists", "(profile)"]
let lastTabIndex = -1

/** Routes that appear without a transition (the player takes over the screen at once). */
const INSTANT_ROUTES = new Set(["(media)"])

function animateIn(view: React.ComponentRef<typeof View> | null, from: { x: number; opacity: number }, duration: number) {
    const node = view as unknown as HTMLElement | null
    if (!node || typeof node.animate !== "function") return
    node.animate([
        { opacity: from.opacity, transform: `translateX(${from.x}px)` },
        { opacity: 1, transform: "translateX(0px)" },
    ], { duration, easing: EASING })
}

/**
 * For the view holding the TV tabs: slides the new tab in from the side its
 * nav item lies on whenever `tab` (the route segment under `(tabs)`) changes.
 * Pages opened on top don't count, so coming back to the same tab stays put.
 */
export function useTVTabTransition(tab: string | undefined) {
    const ref = React.useRef<React.ComponentRef<typeof View>>(null)

    React.useEffect(() => {
        if (!ENABLED || !tab) return
        const index = TAB_ORDER.indexOf(tab)
        // Decide before updating lastTabIndex: Terser (Metro's minifier) folded a
        // `const previous = lastTabIndex` copy into reads made after the update,
        // so no tab ever animated in the release build.
        if (lastTabIndex >= 0 && index >= 0 && lastTabIndex !== index) {
            animateIn(ref.current, { x: (index > lastTabIndex ? 1 : -1) * tvSize(64), opacity: 0 }, 280)
        }
        lastTabIndex = index
    }, [tab])

    return ref
}

function StackTransition({ route, navigation, children }: ScreenLayoutProps) {
    const ref = React.useRef<React.ComponentRef<typeof View>>(null)
    const shownBefore = React.useRef(false)

    React.useEffect(() => navigation.addListener("focus", () => {
        if (INSTANT_ROUTES.has(route.name)) return
        if (!shownBefore.current) {
            shownBefore.current = true
            // A pushed page slides in from the right; a navigator's first screen just appears.
            const { routes } = navigation.getState()
            if (routes.findIndex(r => r.key === route.key) > 0) animateIn(ref.current, { x: tvSize(96), opacity: 0 }, 320)
            return
        }
        // Back: the page underneath eases in from the left.
        animateIn(ref.current, { x: -tvSize(48), opacity: 0.35 }, 280)
    }), [navigation, route.key, route.name])

    return <View ref={ref} style={{ flex: 1 }}>{children}</View>
}

/** `screenLayout` for stacks (opening a page, going back); undefined off webOS. */
export const tvStackScreenLayout = ENABLED
    ? (props: ScreenLayoutProps) => <StackTransition {...props} />
    : undefined
