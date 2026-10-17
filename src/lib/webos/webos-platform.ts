/**
 * Small wrappers around the webOS runtime (PalmSystem / webOSSystem and the
 * document events webOS adds). Everything degrades to a no-op in a desktop
 * browser so the webOS build can be developed there.
 */

type WebOSSystem = {
    platformBack?: () => void
    deviceInfo?: string
}

type WebOSWindow = Window & {
    webOSSystem?: WebOSSystem
    PalmSystem?: WebOSSystem
}

function system(): WebOSSystem | undefined {
    if (typeof window === "undefined") return undefined
    const w = window as WebOSWindow
    return w.webOSSystem ?? w.PalmSystem
}

export function isWebOSDevice() {
    if (system()) return true
    return typeof navigator !== "undefined" && /Web0S|webOS/i.test(navigator.userAgent)
}

/** Back on the first screen hands control back to the TV, as LG's guidelines ask. */
export function exitApp() {
    const webos = system()
    if (webos?.platformBack) {
        webos.platformBack()
        return
    }
    window.close()
}

type VisibilityEvent = Event & { detail?: { visibility?: boolean } }

function onVisibilityEvent(name: string, callback: (visible: boolean) => void) {
    if (typeof document === "undefined") return () => {}
    const handler = (event: Event) => {
        const visible = (event as VisibilityEvent).detail?.visibility
        if (typeof visible === "boolean") callback(visible)
    }
    document.addEventListener(name, handler)
    return () => document.removeEventListener(name, handler)
}

/** The Magic Remote pointer appears when the remote is moved and hides after a few seconds. */
export function onCursorVisibilityChange(callback: (visible: boolean) => void) {
    return onVisibilityEvent("cursorStateChange", callback)
}

type KeyboardEventName = "keyboardDidShow" | "keyboardDidHide" | "keyboardWillShow" | "keyboardWillHide"
type KeyboardListener = (event: { endCoordinates: { height: number; width: number; screenX: number; screenY: number } }) => void

const keyboardListeners = new Map<KeyboardEventName, Set<KeyboardListener>>()

export function addKeyboardListener(name: KeyboardEventName, listener: KeyboardListener) {
    const set = keyboardListeners.get(name) ?? new Set()
    set.add(listener)
    keyboardListeners.set(name, set)
    return () => {
        set.delete(listener)
    }
}

export function emitKeyboardEvent(name: KeyboardEventName) {
    const event = { endCoordinates: { height: 0, width: 0, screenX: 0, screenY: 0 } }
    for (const listener of Array.from(keyboardListeners.get(name) ?? [])) listener(event)
}

/** The on-screen keyboard; on webOS it reports itself through `keyboardStateChange`. */
export function onKeyboardVisibilityChange(callback: (visible: boolean) => void) {
    return onVisibilityEvent("keyboardStateChange", (visible) => {
        emitKeyboardEvent(visible ? "keyboardWillShow" : "keyboardWillHide")
        emitKeyboardEvent(visible ? "keyboardDidShow" : "keyboardDidHide")
        callback(visible)
    })
}
