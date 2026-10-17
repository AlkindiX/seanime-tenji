import * as React from "react"
import type { PressableProps, View } from "react-native"
import BasePressable from "react-native-web/dist/exports/Pressable"
import "../install"
import { preferredDataSet, usePreferredFocusRef } from "../preferred-focus"

type TVPressableProps = PressableProps & {
    dataSet?: Record<string, unknown>
}

/** Pressable plus `hasTVPreferredFocus` and `isTVSelectable`. */
const Pressable = React.forwardRef<View, TVPressableProps>(function Pressable({
    hasTVPreferredFocus,
    isTVSelectable,
    tvParallaxProperties: _tvParallaxProperties,
    focusable,
    dataSet,
    ...props
}, forwardedRef) {
    const ref = usePreferredFocusRef(forwardedRef, hasTVPreferredFocus)
    const selectable = isTVSelectable !== false && focusable !== false

    return (
        <BasePressable
            {...props}
            ref={ref}
            focusable={selectable ? focusable : false}
            // react-native-web's Pressable sets tabIndex 0 itself, which outranks
            // `focusable`; without this, D-pad focus and audio guidance would stop
            // on presses meant for the pointer only (drawer backdrops).
            {...(selectable ? null : { tabIndex: -1 })}
            dataSet={preferredDataSet(dataSet, hasTVPreferredFocus)}
        />
    )
})

Pressable.displayName = "Pressable"

export default Pressable
