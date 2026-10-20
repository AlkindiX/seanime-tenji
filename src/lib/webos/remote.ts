/**
 * Remote control input for the webOS build.
 *
 * Turns key events from the LG remote (and a desktop keyboard while
 * developing) into what react-native-tvos gives the app natively: D-pad
 * focus movement, `useTVEventHandler` events and `hardwareBackPress`.
 */
import { createWheelStepper, isDigitEventType, remoteEventType } from "./remote-input"
import { animateScroll, stopScroll } from "./scroll-animator"
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
type ClickListener = () => void

/** webOS sends 461 for Back; Escape and Backspace stand in for it on a desktop. */
const BACK_KEY_CODE = 461

const LONG_PRESS_TYPES = new Set(["left", "right", "up", "down", "select"])

/** D-pad keys report press and release; react-native-tvos sends every other key once per press. */
const PRESS_AND_RELEASE_TYPES = new Set(["left", "right", "up", "down", "select"])

const listeners = new Set<Listener>()
const pointerListeners = new Set<PointerListener>()
const clickListeners = new Set<ClickListener>()
const backListeners: Array<() => boolean | null | undefined> = []
let fallbackBackHandler: (() => boolean) | null = null
const modalStack: Array<{ close: () => void }> = []
const longPressed = new Set<string>()
let installed = false
let pointerMode = false
let checkFocusSoon: () => void = () => {}
let checkFocusLater: () => void = () => {}

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

    if (fallbackBackHandler?.()) {
        // The screen left behind keeps focus until the navigator hides it.
        checkFocusLater()
        return
    }
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
        // Focus may still sit on a hidden screen's control; don't let it press.
        event.preventDefault()
        event.stopPropagation()
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

function onMouseDown(event: MouseEvent) {
    if (!pointerMode) setPointerMode(true)
    notifyPointerActivity(true)
    // No autoscroll cursor for a middle button; it pauses and plays instead.
    if (event.button === 1) event.preventDefault()
}

const HOVER_FOCUSABLE = "[tabindex]:not([tabindex=\"-1\"]),input,textarea,button,a[href]"

/**
 * Called when the Magic Remote clicks somewhere that isn't a control (the
 * video in the player), or presses a middle button. The wheel is the OK
 * button: with the pointer showing, pressing it clicks where it points.
 */
export function onPointerClick(listener: ClickListener) {
    clickListeners.add(listener)
    return () => {
        clickListeners.delete(listener)
    }
}

function emitPointerClick() {
    for (const listener of Array.from(clickListeners)) {
        try {
            listener()
        } catch (error) {
            console.error("[webOS] pointer click listener failed", error)
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
// Dragging lists with the pointer
///////////////////////////////////////////////////////////////////////////////

/** Travel before a press becomes a drag; less is a click from an unsteady hand. */
const DRAG_THRESHOLD_PX = 12
/** Speed is measured over the last part of a drag. */
const FLING_SAMPLE_MS = 100
/** A released drag glides on by its speed (px/ms) times this. */
const FLING_MS = 280
/** Slower than this (px/ms), a release just stops. */
const FLING_MIN_SPEED = 0.25
/** The click that ends a drag arrives right after the release. */
const SWALLOW_CLICK_MS = 400

type Drag = {
    startX: number
    startY: number
    target: Element
    scroller: HTMLElement | null
    axis: "x" | "y"
    origin: number
    samples: Array<{ time: number; position: number }>
}

let drag: Drag | null = null
let swallowClickUntil = 0

function onDragStart(event: MouseEvent) {
    drag = null
    if (event.button !== 0 || !(event.target instanceof Element) || isTextField(event.target)) return
    drag = { startX: event.clientX, startY: event.clientY, target: event.target, scroller: null, axis: "x", origin: 0, samples: [] }
}

function onDragMove(event: MouseEvent) {
    const current = drag
    if (!current) return
    // The release happened somewhere we didn't see it (outside the window).
    if ((event.buttons & 1) === 0) {
        endDrag(event.timeStamp)
        return
    }

    let scroller = current.scroller
    if (!scroller) {
        const dx = event.clientX - current.startX
        const dy = event.clientY - current.startY
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        // A row drags sideways, the page up and down: whichever way the pointer went most.
        const axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
        scroller = scrollableAncestor(current.target, axis)
        if (!scroller) {
            drag = null
            return
        }
        stopScroll(scroller)
        current.axis = axis
        current.scroller = scroller
        current.origin = axis === "x" ? scroller.scrollLeft : scroller.scrollTop
        document.documentElement.toggleAttribute("data-tv-dragging", true)
    }

    // The list follows the pointer, less the threshold so it doesn't jump when the drag starts.
    const travel = current.axis === "x" ? event.clientX - current.startX : event.clientY - current.startY
    const position = current.origin - Math.sign(travel) * Math.max(0, Math.abs(travel) - DRAG_THRESHOLD_PX)
    if (current.axis === "x") scroller.scrollLeft = position
    else scroller.scrollTop = position

    current.samples.push({ time: event.timeStamp, position })
    while (current.samples.length > 2 && event.timeStamp - current.samples[0].time > FLING_SAMPLE_MS) current.samples.shift()
    window.getSelection()?.removeAllRanges()
    event.preventDefault()
}

function endDrag(time: number) {
    const current = drag
    drag = null
    if (!current?.scroller) return
    document.documentElement.toggleAttribute("data-tv-dragging", false)
    swallowClickUntil = performance.now() + SWALLOW_CLICK_MS

    const first = current.samples[0]
    const last = current.samples[current.samples.length - 1]
    if (!first || !last || last.time === first.time || time - last.time > FLING_SAMPLE_MS) return
    const speed = (last.position - first.position) / (last.time - first.time)
    if (Math.abs(speed) < FLING_MIN_SPEED) return
    const glide = last.position + speed * FLING_MS
    animateScroll(current.scroller, current.axis === "x" ? { x: glide } : { y: glide })
}

function onDragEnd(event: MouseEvent) {
    if (event.button === 0) endDrag(event.timeStamp)
}

/** Clicks: none after a drag (it would open the card it ended on); the rest may be a pointer click. */
function onClick(event: MouseEvent) {
    if (performance.now() < swallowClickUntil) {
        swallowClickUntil = 0
        event.preventDefault()
        event.stopPropagation()
        return
    }
    if (!pointerMode || !(event.target instanceof Element)) return
    if (event.target.closest(HOVER_FOCUSABLE)) return
    emitPointerClick()
}

/** A middle button, where a pointing device has one, acts on the screen as a whole. */
function onAuxClick(event: MouseEvent) {
    if (event.button !== 1) return
    event.preventDefault()
    emitPointerClick()
}

/**
 * With the Magic Remote pointer, focus follows the cursor so TV highlights
 * still show. A text field is never focused by hovering it, as focus opens
 * the TV's keyboard: the hover goes to the control around it (the TV inputs
 * wrap their field in one that starts editing on click), and a click
 * focuses the field itself.
 */
function onPointerOver(event: MouseEvent) {
    // Cards passing under a dragging pointer don't take focus.
    if (!pointerMode || drag?.scroller || !(event.target instanceof Element)) return
    let target = event.target.closest<HTMLElement>(HOVER_FOCUSABLE)
    while (target && isTextField(target)) target = target.parentElement?.closest<HTMLElement>(HOVER_FOCUSABLE) ?? null
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
    checkFocusLater = schedule
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
    document.addEventListener("mousedown", onMouseDown, { capture: true, passive: false })
    document.addEventListener("mouseover", onPointerOver, true)
    document.addEventListener("mousedown", onDragStart, true)
    document.addEventListener("mousemove", onDragMove, { capture: true, passive: false })
    window.addEventListener("mouseup", onDragEnd, true)
    // Before react-native-web's handlers, which press a Pressable on click.
    window.addEventListener("click", onClick, true)
    window.addEventListener("auxclick", onAuxClick, true)
    // Images would start the browser's own drag and drop instead.
    document.addEventListener("dragstart", event => event.preventDefault(), true)
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
