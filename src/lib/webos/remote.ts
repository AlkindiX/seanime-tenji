/**
 * Remote control input for the webOS build.
 *
 * Turns key events from the LG remote (and a desktop keyboard while
 * developing) into what react-native-tvos gives the app natively: D-pad
 * focus movement, `useTVEventHandler` events and `hardwareBackPress`.
 */
import { type Direction, focusElement, focusInitial, getFocusedElement, moveFocus, trackFocus } from "./spatial-navigation"
import { emitKeyboardEvent, exitApp, onCursorVisibilityChange, onKeyboardVisibilityChange } from "./webos-platform"

export type TVRemoteEvent = {
    eventType: string
    eventKeyAction: 0 | 1
    tag?: number
}

type Listener = (event: TVRemoteEvent) => void

const KEY_CODES: Record<number, string> = {
    37: "left",
    38: "up",
    39: "right",
    40: "down",
    13: "select",
    415: "play",
    19: "pause",
    179: "playPause",
    413: "stop",
    417: "fastForward",
    412: "rewind",
    33: "channelUp",
    34: "channelDown",
    457: "info",
    403: "red",
    404: "green",
    405: "yellow",
    406: "blue",
}

const KEY_NAMES: Record<string, string> = {
    ArrowLeft: "left",
    ArrowUp: "up",
    ArrowRight: "right",
    ArrowDown: "down",
    Enter: "select",
    MediaPlayPause: "playPause",
    MediaPlay: "play",
    MediaPause: "pause",
    MediaStop: "stop",
    MediaFastForward: "fastForward",
    MediaRewind: "rewind",
}

/** webOS sends 461 for Back; Escape and Backspace stand in for it on a desktop. */
const BACK_KEY_CODE = 461

const LONG_PRESS_TYPES = new Set(["left", "right", "up", "down", "select"])

/** D-pad keys report press and release; react-native-tvos sends every other key once per press. */
const PRESS_AND_RELEASE_TYPES = new Set(["left", "right", "up", "down", "select"])

const listeners = new Set<Listener>()
const backListeners: Array<() => boolean | null | undefined> = []
let fallbackBackHandler: (() => boolean) | null = null
const modalStack: Array<{ close: () => void }> = []
const longPressed = new Set<string>()
let installed = false
let pointerMode = false

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
    return KEY_CODES[event.keyCode] ?? KEY_NAMES[event.key]
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
    // Left/right move the caret while typing; everything else navigates.
    if (inTextField && (type === "left" || type === "right")) return
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
            emit({ eventType: `long${type[0].toUpperCase()}${type.slice(1)}`, eventKeyAction: 0 })
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
    if (isTextField(document.activeElement) && (type === "left" || type === "right")) return

    if (longPressed.delete(type)) {
        emit({ eventType: `long${type[0].toUpperCase()}${type.slice(1)}`, eventKeyAction: 1 })
        return
    }
    emit({ eventType: type, eventKeyAction: 1 })
}

function setPointerMode(enabled: boolean) {
    pointerMode = enabled
    document.documentElement.toggleAttribute("data-tv-pointer", enabled)
}

/** With the Magic Remote pointer, focus follows the cursor so TV highlights still show. */
function onPointerOver(event: MouseEvent) {
    if (!pointerMode || !(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>("[tabindex]:not([tabindex=\"-1\"]),input,textarea,button,a[href]")
    if (target && target !== document.activeElement && !isTextField(document.activeElement)) {
        focusElement(target, { reveal: false })
    }
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
        if (!getFocusedElement()) focusInitial()
    }
    const schedule = () => {
        if (pending === null) pending = setTimeout(check, 250)
    }
    document.addEventListener("focusout", schedule, true)
    setInterval(() => {
        if (!getFocusedElement()) schedule()
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
    document.addEventListener("mousemove", () => {
        if (!pointerMode) setPointerMode(true)
    }, { passive: true })
    document.addEventListener("mouseover", onPointerOver, true)
    onCursorVisibilityChange(setPointerMode)
    onKeyboardVisibilityChange((visible) => {
        const active = document.activeElement
        if (!visible && isTextField(active)) active.blur()
    })
    watchLostFocus()
}
