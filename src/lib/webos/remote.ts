/**
 * Remote control input for the webOS build.
 *
 * Turns key events from the LG remote (and a desktop keyboard while
 * developing) into what react-native-tvos gives the app natively: D-pad
 * focus movement, `useTVEventHandler` events and `hardwareBackPress`.
 */
import { createWheelStepper, isDigitEventType, remoteEventType } from "./remote-input"
import {
    type Direction,
    focusElement,
    focusInitial,
    getFocusedElement,
    getFocusRoot,
    isFocusable,
    moveFocus,
    nearestScroller,
    pageFocus,
    scrollableAncestor,
    trackFocus,
} from "./spatial-navigation"
import {
    emitKeyboardEvent,
    exitApp,
    onCursorVisibilityChange,
    onKeyboardVisibilityChange,
    onPointerPresenceChange,
    onRelaunch,
} from "./webos-platform"

export type TVRemoteEvent = {
    eventType: string
    eventKeyAction: 0 | 1
    tag?: number
}

type Listener = (event: TVRemoteEvent) => void
type PointerListener = () => void

/** webOS sends 461 for Back; Escape and Backspace stand in for it on a desktop. */
const BACK_KEY_CODE = 461

const LONG_PRESS_TYPES = new Set(["left", "right", "up", "down", "select"])

/** D-pad keys report press and release; react-native-tvos sends every other key once per press. */
const PRESS_AND_RELEASE_TYPES = new Set(["left", "right", "up", "down", "select"])

const listeners = new Set<Listener>()
const pointerListeners = new Set<PointerListener>()
const backListeners: Array<() => boolean | null | undefined> = []
let fallbackBackHandler: (() => boolean) | null = null
const modalStack: Array<{ close: () => void }> = []
const longPressed = new Set<string>()
let installed = false
let pointerMode = false
let checkFocusSoon: () => void = () => {}

export function addTVEventListener(listener: Listener) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function emit(event: TVRemoteEvent) {
    for (const listener of Array.from(listeners)) {
        try {
            listener(event)
        } catch (error) {
            console.error("[webOS] TV event listener failed", error)
        }
    }
}

export function addBackListener(listener: () => boolean | null | undefined) {
    backListeners.push(listener)
    return () => {
        const index = backListeners.lastIndexOf(listener)
        if (index >= 0) backListeners.splice(index, 1)
    }
}

/** Runs when no Modal and no BackHandler listener consumed Back (the router goes back here). */
export function setFallbackBackHandler(handler: (() => boolean) | null) {
    fallbackBackHandler = handler
}

/** Modals register here so Back closes the top one first, as on Android. */
export function pushModal(close: () => void) {
    const entry = { close }
    modalStack.push(entry)
    return () => {
        const index = modalStack.indexOf(entry)
        if (index >= 0) modalStack.splice(index, 1)
    }
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
    if (!el) return false
    if (el instanceof HTMLTextAreaElement) return true
    return el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit"].includes(el.type)
}

/**
 * Native TV keyboards close with Back or their Done key and report
 * `keyboardDidHide` while the field is still focused; the TV inputs listen for
 * that to hand focus back to their field.
 */
function closeKeyboard(field: HTMLInputElement | HTMLTextAreaElement) {
    emitKeyboardEvent("keyboardWillHide")
    emitKeyboardEvent("keyboardDidHide")
    if (document.activeElement === field) field.blur()
}

export function handleBack() {
    const active = document.activeElement
    if (isTextField(active)) {
        closeKeyboard(active)
        return
    }

    const modal = modalStack[modalStack.length - 1]
    if (modal) {
        modal.close()
        return
    }

    for (let i = backListeners.length - 1; i >= 0; i--) {
        if (backListeners[i]()) return
    }

    if (fallbackBackHandler?.()) return
    exitApp()
}

function eventTypeOf(event: KeyboardEvent) {
    return remoteEventType(event.keyCode, event.key)
}

/** Keys a text field keeps for itself: the caret keys and the digits. */
function belongsToTextField(type: string) {
    return type === "left" || type === "right" || isDigitEventType(type)
}

function longType(type: string) {
    return `long${type[0].toUpperCase()}${type.slice(1)}`
}

/**
 * A key held while the app is hidden never reports its release, which would
 * leave a long press (and the player's long seek) running. End them all.
 */
function releaseHeldKeys() {
    const held = Array.from(longPressed)
    longPressed.clear()
    for (const type of held) emit({ eventType: longType(type), eventKeyAction: 1 })
}

function isBackKey(event: KeyboardEvent) {
    if (event.keyCode === BACK_KEY_CODE || event.key === "GoBack" || event.key === "BrowserBack") return true
    if (event.key === "Escape") return true
    return event.key === "Backspace" && !isTextField(document.activeElement)
}

function onKeyDown(event: KeyboardEvent) {
    if (isBackKey(event)) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) handleBack()
        return
    }

    const type = eventTypeOf(event)
    if (!type) return

    const active = document.activeElement
    const inTextField = isTextField(active)
    // Left/right move the caret and digits type while typing; everything else navigates.
    if (inTextField && belongsToTextField(type)) return
    if (inTextField && type === "select" && active instanceof HTMLInputElement) {
        // Let react-native-web submit first, then close the keyboard.
        setTimeout(() => {
            if (document.activeElement === active) closeKeyboard(active)
        }, 0)
        return
    }

    if (event.repeat && LONG_PRESS_TYPES.has(type)) {
        if (!longPressed.has(type)) {
            longPressed.add(type)
            emit({ eventType: longType(type), eventKeyAction: 0 })
        }
    } else if (!event.repeat && PRESS_AND_RELEASE_TYPES.has(type)) {
        emit({ eventType: type, eventKeyAction: 0 })
    }

    if (type === "up" || type === "down" || type === "left" || type === "right") {
        event.preventDefault()
        if (pointerMode) setPointerMode(false)
        moveFocus(type as Direction)
    } else if (type === "select" && !getFocusedElement()) {
        event.preventDefault()
        focusInitial()
    } else if (type === "channelUp" || type === "channelDown") {
        // CH+/CH- page through lists. The TV event still goes out on release
        // (the player switches episodes with it); outside a list nothing scrolls.
        if (pageFocus(type === "channelUp" ? "up" : "down")) event.preventDefault()
    }
}

function onKeyUp(event: KeyboardEvent) {
    if (isBackKey(event)) {
        event.preventDefault()
        event.stopPropagation()
        return
    }

    const type = eventTypeOf(event)
    if (!type) return
    if (isTextField(document.activeElement) && belongsToTextField(type)) return

    if (longPressed.delete(type)) {
        emit({ eventType: longType(type), eventKeyAction: 1 })
        return
    }
    emit({ eventType: type, eventKeyAction: 1 })
}

function setPointerMode(enabled: boolean) {
    pointerMode = enabled
    document.documentElement.toggleAttribute("data-tv-pointer", enabled)
}

/**
 * Called while the Magic Remote pointer moves or clicks (a few times a
 * second at most), so screens can react to it like a touch. The player
 * shows its controls.
 */
export function onPointerActivity(listener: PointerListener) {
    pointerListeners.add(listener)
    return () => {
        pointerListeners.delete(listener)
    }
}

const POINTER_ACTIVITY_INTERVAL = 250
/** Hand tremor and layout-driven synthetic moves don't count as moving the pointer. */
const POINTER_MIN_TRAVEL = 4

let lastPointerActivity = 0
let lastPointer: { x: number; y: number } | null = null

function notifyPointerActivity(force: boolean) {
    const now = Date.now()
    if (!force && now - lastPointerActivity < POINTER_ACTIVITY_INTERVAL) return
    lastPointerActivity = now
    for (const listener of Array.from(pointerListeners)) {
        try {
            listener()
        } catch (error) {
            console.error("[webOS] pointer listener failed", error)
        }
    }
}

function onMouseMove(event: MouseEvent) {
    const previous = lastPointer
    if (previous && Math.abs(previous.x - event.screenX) + Math.abs(previous.y - event.screenY) < POINTER_MIN_TRAVEL) return
    lastPointer = { x: event.screenX, y: event.screenY }
    if (!pointerMode) setPointerMode(true)
    notifyPointerActivity(false)
}

function onMouseDown() {
    if (!pointerMode) setPointerMode(true)
    notifyPointerActivity(true)
}

/** With the Magic Remote pointer, focus follows the cursor so TV highlights still show. */
function onPointerOver(event: MouseEvent) {
    if (!pointerMode || !(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>("[tabindex]:not([tabindex=\"-1\"]),input,textarea,button,a[href]")
    if (target && target !== document.activeElement && !isTextField(document.activeElement)) {
        focusElement(target, { reveal: false })
    }
}

/** One focus step per wheel notch at most, and no faster than this. */
const wheelStep = createWheelStepper({ step: 100, interval: 120 })

/**
 * The Magic Remote wheel. Without the pointer (5-way mode) it scrolls
 * whatever was last under the cursor while focus stays put, so the next
 * arrow press jumps back. Instead it moves focus through the list around
 * the focused element, and does nothing outside one (the player).
 *
 * With the pointer, the browser scrolls as usual, except over a list that
 * only scrolls sideways (a rail), which the wheel would otherwise skip.
 */
function onWheel(event: WheelEvent) {
    if (event.ctrlKey) return

    if (!pointerMode) {
        event.preventDefault()
        const focused = getFocusedElement()
        if (focused && !scrollableAncestor(focused, "y")) return
        const step = wheelStep(event.deltaY, event.deltaMode, Date.now())
        if (step !== 0) moveFocus(step > 0 ? "down" : "up")
        return
    }

    if (!(event.target instanceof Element) || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    const scroller = nearestScroller(event.target)
    if (!scroller || !scroller.x || scroller.y) return
    const { node } = scroller
    const delta = event.deltaMode === 0 ? event.deltaY : event.deltaY * 40
    const canScroll = delta > 0
        ? node.scrollLeft + node.clientWidth < node.scrollWidth - 1
        : node.scrollLeft > 0
    // At either end the page underneath scrolls instead, so it never gets stuck.
    if (!canScroll) return
    event.preventDefault()
    node.scrollLeft += delta
}

/**
 * True when focus sits somewhere the D-pad can't reach or highlight: nowhere
 * (<body>), or on an element react-native-web's modal focus trap picked
 * because `focus()` works on it (a backdrop or a zero-height sentinel).
 */
function focusIsLost() {
    const focused = getFocusedElement()
    return !focused || (!isTextField(focused) && !isFocusable(focused, getFocusRoot()))
}

/**
 * Native TV focus never disappears; in a browser it falls back to <body>
 * when the focused element unmounts. Put it back on something visible.
 */
function watchLostFocus() {
    let pending: ReturnType<typeof setTimeout> | null = null
    const check = () => {
        pending = null
        if (pointerMode || document.hidden) return
        if (focusIsLost()) focusInitial()
    }
    const schedule = () => {
        if (pending === null) pending = setTimeout(check, 250)
    }
    checkFocusSoon = () => {
        if (pending !== null) clearTimeout(pending)
        pending = setTimeout(check, 0)
    }
    document.addEventListener("focusout", schedule, true)
    document.addEventListener("focusin", () => {
        if (!pointerMode && focusIsLost()) checkFocusSoon()
    }, true)
    setInterval(() => {
        if (focusIsLost()) schedule()
    }, 600)
}

export function installRemote() {
    if (installed || typeof window === "undefined") return
    installed = true

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    document.addEventListener("focusin", event => {
        if (event.target instanceof Element) trackFocus(event.target)
    }, true)
    document.addEventListener("mousemove", onMouseMove, { passive: true })
    document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true })
    document.addEventListener("mouseover", onPointerOver, true)
    window.addEventListener("wheel", onWheel, { capture: true, passive: false })
    onCursorVisibilityChange(setPointerMode)
    // A system overlay took the pointer: show the D-pad focus again.
    onPointerPresenceChange((inside) => {
        if (!inside && pointerMode) setPointerMode(false)
    })
    onKeyboardVisibilityChange((visible) => {
        const active = document.activeElement
        if (!visible && isTextField(active)) active.blur()
    })
    watchLostFocus()

    // Leaving the app (Home, an input switch) swallows the release of a held key.
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) releaseHeldKeys()
        else checkFocusSoon()
    })
    window.addEventListener("blur", releaseHeldKeys)
    onRelaunch(() => checkFocusSoon())
}
