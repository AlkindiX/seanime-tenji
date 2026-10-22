import * as React from "react"
import { pushModal } from "./remote"

/**
 * While `active`, the remote's Back calls `onBack` and goes no further: it
 * sits on top of the Modal stack, which remote.ts asks before any
 * BackHandler listener. The player uses it so Back drops a seek target that
 * is still pending, and does nothing else on that press.
 */
export function useBackIntercept(active: boolean, onBack: () => void) {
    const latest = React.useRef(onBack)
    latest.current = onBack

    React.useEffect(() => {
        if (!active) return
        return pushModal(() => latest.current())
    }, [active])
}
