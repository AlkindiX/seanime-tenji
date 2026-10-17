import * as React from "react"
import { focusElement } from "./spatial-navigation"

/**
 * `hasTVPreferredFocus`: focus the element once it is mounted (and whenever
 * the prop turns true again), and mark it so lost focus recovers onto it.
 */
export function usePreferredFocusRef<T>(forwardedRef: React.Ref<T> | undefined, preferred: boolean | undefined) {
    const nodeRef = React.useRef<HTMLElement | null>(null)

    const ref = React.useCallback((value: T | null) => {
        nodeRef.current = value as unknown as HTMLElement | null
        if (typeof forwardedRef === "function") forwardedRef(value as T)
        else if (forwardedRef) (forwardedRef as React.RefObject<T | null>).current = value
    }, [forwardedRef])

    React.useEffect(() => {
        if (!preferred) return
        const frame = requestAnimationFrame(() => {
            const node = nodeRef.current
            if (node?.isConnected) focusElement(node)
        })
        return () => cancelAnimationFrame(frame)
    }, [preferred])

    return ref
}

export function preferredDataSet(dataSet: Record<string, unknown> | undefined, preferred: boolean | undefined) {
    if (!preferred) return dataSet
    // rendered as data-tv-preferred
    return { ...dataSet, tvPreferred: "true" }
}
