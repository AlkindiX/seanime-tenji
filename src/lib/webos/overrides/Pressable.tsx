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

    return (
        <BasePressable
            {...props}
            ref={ref}
            focusable={isTVSelectable === false ? false : focusable}
            dataSet={preferredDataSet(dataSet, hasTVPreferredFocus)}
        />
    )
})

Pressable.displayName = "Pressable"

export default Pressable
