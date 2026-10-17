import * as React from "react"
import type { TouchableHighlightProps, View } from "react-native"
import BaseTouchableHighlight from "react-native-web/dist/exports/TouchableHighlight"
import "../install"
import { preferredDataSet, usePreferredFocusRef } from "../preferred-focus"

type TVTouchableHighlightProps = TouchableHighlightProps & {
    dataSet?: Record<string, unknown>
}

/** TouchableHighlight plus `hasTVPreferredFocus`. */
const TouchableHighlight = React.forwardRef<View, TVTouchableHighlightProps>(function TouchableHighlight({
    hasTVPreferredFocus,
    tvParallaxProperties: _tvParallaxProperties,
    dataSet,
    ...props
}, forwardedRef) {
    const ref = usePreferredFocusRef(forwardedRef, hasTVPreferredFocus)

    return <BaseTouchableHighlight {...props} ref={ref} dataSet={preferredDataSet(dataSet, hasTVPreferredFocus)} />
})

TouchableHighlight.displayName = "TouchableHighlight"

export default TouchableHighlight
