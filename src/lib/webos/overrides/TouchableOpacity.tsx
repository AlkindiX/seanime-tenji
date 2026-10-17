import * as React from "react"
import type { TouchableOpacityProps, View } from "react-native"
import BaseTouchableOpacity from "react-native-web/dist/exports/TouchableOpacity"
import "../install"
import { preferredDataSet, usePreferredFocusRef } from "../preferred-focus"

type TVTouchableOpacityProps = TouchableOpacityProps & {
    dataSet?: Record<string, unknown>
}

/** TouchableOpacity plus `hasTVPreferredFocus`. */
const TouchableOpacity = React.forwardRef<View, TVTouchableOpacityProps>(function TouchableOpacity({
    hasTVPreferredFocus,
    tvParallaxProperties: _tvParallaxProperties,
    dataSet,
    ...props
}, forwardedRef) {
    const ref = usePreferredFocusRef(forwardedRef, hasTVPreferredFocus)

    return <BaseTouchableOpacity {...props} ref={ref} dataSet={preferredDataSet(dataSet, hasTVPreferredFocus)} />
})

TouchableOpacity.displayName = "TouchableOpacity"

export default TouchableOpacity
