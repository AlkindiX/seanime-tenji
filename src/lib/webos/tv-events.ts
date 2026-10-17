import * as React from "react"
import { addTVEventListener, type TVRemoteEvent } from "./remote"

export type { TVRemoteEvent }

/** Same contract as react-native-tvos: called for every remote key press and release. */
export function useTVEventHandler(handler: (event: TVRemoteEvent) => void) {
    const latest = React.useRef(handler)
    latest.current = handler

    React.useEffect(() => addTVEventListener(event => latest.current(event)), [])
}

export class TVEventHandler {
    private remove: (() => void) | null = null

    enable(_component: unknown, callback: (component: unknown, event: TVRemoteEvent) => void) {
        this.disable()
        this.remove = addTVEventListener(event => callback(_component, event))
    }

    disable() {
        this.remove?.()
        this.remove = null
    }
}

/** The menu/pan gesture switches are tvOS concepts; the remote always delivers them here. */
export const TVEventControl = {
    enableTVMenuKey() {},
    disableTVMenuKey() {},
    enableTVPanGesture() {},
    disableTVPanGesture() {},
    enableGestureHandlersCancelTouches() {},
    disableGestureHandlersCancelTouches() {},
}
