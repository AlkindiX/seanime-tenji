/**
 * Small wrappers around the webOS runtime (PalmSystem / webOSSystem and the
 * document events webOS adds). Everything degrades to a no-op in a desktop
 * browser so the webOS build can be developed there.
 */

type WebOSSystem = {
    platformBack?: () => void
    deviceInfo?: string
    /** The parameters the app was (last) launched with, a JSON string; LG's webOSDev.launchParams() parses it. */
    launchParams?: unknown
}

type WebOSWindow = {
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

/**
 * `platformBack()` bound to the object that has it. Newer TVs expose both
 * `webOSSystem` and `PalmSystem`, and either may lack the method (LG's
 * webOSTV.js only ever calls `PalmSystem.platformBack`).
 */
export function findPlatformBack(w: WebOSWindow): (() => void) | null {
    for (const owner of [w.webOSSystem, w.PalmSystem]) {
        if (owner && typeof owner.platformBack === "function") {
            return () => owner.platformBack!()
        }
    }
    return null
}

/**
 * Back on the first screen hands control back to the TV, as LG's guidelines
 * ask: webOS 6 and later show the system's exit popup, older releases go to
 * the launcher. `window.close()` (no popup) is only for desktop browsers.
 */
export function exitApp() {
    const platformBack = findPlatformBack(window as WebOSWindow)
    if (platformBack) {
        platformBack()
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

/**
 * `webOSMouse` says whether the pointer is over the app: "Leave" when the app
 * went to the background or a system overlay or toast took the pointer.
 */
export function onPointerPresenceChange(callback: (inside: boolean) => void) {
    if (typeof document === "undefined") return () => {}
    const handler = (event: Event) => {
        const type = (event as Event & { detail?: { type?: string } }).detail?.type
        if (type === "Enter" || type === "Leave") callback(type === "Enter")
    }
    document.addEventListener("webOSMouse", handler)
    return () => document.removeEventListener("webOSMouse", handler)
}

/** Fired before the app comes back from the background (it is relaunched while running). */
export function onRelaunch(callback: () => void) {
    if (typeof document === "undefined") return () => {}
    document.addEventListener("webOSRelaunch", callback, true)
    return () => document.removeEventListener("webOSRelaunch", callback, true)
}

function hasLaunchParams(owner: WebOSSystem | undefined) {
    const params = owner?.launchParams
    return params !== undefined && params !== null && params !== ""
}

/**
 * The launch parameters as the TV keeps them. The `webOSLaunch` event can
 * fire before the bundle has run, so the first launch is read from here.
 * webOS 5 and later have them on `webOSSystem`, older releases on `PalmSystem`.
 */
export function findLaunchParams(w: WebOSWindow): unknown {
    for (const owner of [w.webOSSystem, w.PalmSystem]) {
        if (hasLaunchParams(owner)) return owner!.launchParams
    }
    return undefined
}

export function readLaunchParams(): unknown {
    if (typeof window === "undefined") return undefined
    return findLaunchParams(window as WebOSWindow)
}

/**
 * `webOSLaunch` (launched) and `webOSRelaunch` (launched again while running)
 * carry the parameters in `detail`. LG registers both in the capture phase.
 */
export function onLaunchParams(callback: (params: unknown, relaunch: boolean) => void) {
    if (typeof document === "undefined") return () => {}
    const onLaunch = (event: Event) => callback((event as CustomEvent).detail, false)
    const onRelaunchEvent = (event: Event) => callback((event as CustomEvent).detail, true)
    document.addEventListener("webOSLaunch", onLaunch, true)
    document.addEventListener("webOSRelaunch", onRelaunchEvent, true)
    return () => {
        document.removeEventListener("webOSLaunch", onLaunch, true)
        document.removeEventListener("webOSRelaunch", onRelaunchEvent, true)
    }
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
