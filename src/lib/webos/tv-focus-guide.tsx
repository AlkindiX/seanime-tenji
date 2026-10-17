import * as React from "react"
import type { View as RNView, ViewProps } from "react-native"
import View from "react-native-web/dist/exports/View"
import { type FocusGuideConfig, registerFocusGuide } from "./spatial-navigation"

type TVFocusGuideViewProps = ViewProps & {
    autoFocus?: boolean
    destinations?: (unknown | null | undefined)[]
    focusable?: boolean
    trapFocusUp?: boolean
    trapFocusDown?: boolean
    trapFocusLeft?: boolean
    trapFocusRight?: boolean
    safePadding?: "vertical" | "horizontal" | "both" | null
    dataSet?: Record<string, string | boolean | undefined>
}

/** react-native-tvos' TVFocusGuideView for the web: a View the focus engine knows about. */
export const TVFocusGuideView = React.forwardRef<RNView, TVFocusGuideViewProps>(function TVFocusGuideView({
    autoFocus,
    destinations,
    focusable,
    trapFocusUp,
    trapFocusDown,
    trapFocusLeft,
    trapFocusRight,
    safePadding: _safePadding,
    dataSet,
    ...props
}, forwardedRef) {
    const [node, setNode] = React.useState<HTMLElement | null>(null)
    const config = React.useRef<FocusGuideConfig>({ trap: {} })
    config.current = {
        autoFocus,
        focusable,
        destinations: destinations?.filter(Boolean),
        trap: { up: trapFocusUp, down: trapFocusDown, left: trapFocusLeft, right: trapFocusRight },
    }

    React.useLayoutEffect(() => {
        if (!node) return
        return registerFocusGuide(node, () => config.current)
    }, [node])

    const ref = React.useCallback((value: HTMLElement | null) => {
        setNode(value)
        if (typeof forwardedRef === "function") forwardedRef(value as unknown as RNView)
        else if (forwardedRef) forwardedRef.current = value as unknown as RNView
    }, [forwardedRef])

    return (
        <View
            {...props}
            ref={ref}
            // rendered as data-tv-guide
            dataSet={{ ...dataSet, tvGuide: "true" }}
        />
    )
})

TVFocusGuideView.displayName = "TVFocusGuideView"
