import type { TVRemoteEvent } from "react-native"

type TVFocusable = { requestTVFocus?: () => void }

/**
 * Moves TV focus to a view. react-native-tvos adds `requestTVFocus()` to host
 * instances, but its strict TypeScript API
 * doesn't declare it on `ViewInstance`.
 */
export function requestTVFocus(target: object | null | undefined) {
    (target as TVFocusable | null | undefined)?.requestTVFocus?.()
}

/**
 * `0` for key down, `1` for key up. Native code sends a number, while
 * react-native-tvos 0.87+ types `eventKeyAction` as a string.
 */
export function tvKeyAction(event: TVRemoteEvent): 0 | 1 | undefined {
    const action = Number(event.eventKeyAction)
    return action === 0 || action === 1 ? action : undefined
}
