/**
 * D-pad focus engine for the webOS build.
 *
 * react-native-tvos moves focus natively; in a browser every Pressable is a
 * plain focusable <div>, so this module picks the next element geometrically
 * (the same candidate and beam rules Android's FocusFinder uses) and honours
 * the TVFocusGuideView options the app relies on: `trapFocus*`, `autoFocus`
 * (remember the last focused child) and `destinations`.
 */

import { animateScroll, scrollTarget } from "./scroll-animator"

export type Direction = "up" | "down" | "left" | "right"

export type FocusGuideConfig = {
    autoFocus?: boolean
    focusable?: boolean
    trap: Partial<Record<Direction, boolean>>
    destinations?: readonly unknown[]
}

type GuideEntry = {
    config: FocusGuideConfig
    lastFocused: HTMLElement | null
}

const FOCUSABLE_SELECTOR = [
    "[tabindex]:not([tabindex=\"-1\"])",
    "input:not([disabled]):not([type=\"hidden\"])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    "button:not([disabled])",
    "a[href]",
].join(",")

const GUIDE_ATTRIBUTE = "data-tv-guide"
const PREFERRED_ATTRIBUTE = "data-tv-preferred"

const guides = new WeakMap<Element, GuideEntry>()

export function registerFocusGuide(node: HTMLElement, getConfig: () => FocusGuideConfig) {
    const entry: GuideEntry = {
        get config() {
            return getConfig()
        },
        lastFocused: null,
    }
    guides.set(node, entry)
    return () => {
        if (guides.get(node) === entry) guides.delete(node)
    }
}

function isElement(value: unknown): value is HTMLElement {
    return typeof HTMLElement !== "undefined" && value instanceof HTMLElement
}

function isRendered(el: HTMLElement) {
    if (!el.isConnected || el.getClientRects().length === 0) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    return window.getComputedStyle(el).visibility !== "hidden"
}

function insideUnfocusableGuide(el: HTMLElement, root: Element) {
    for (let node = el.parentElement; node && node !== root.parentElement; node = node.parentElement) {
        const entry = guides.get(node)
        if (entry && entry.config.focusable === false) return true
    }
    return false
}

/**
 * Navigators keep inactive screens mounted under the active one (inactive tabs
 * stay laid out at z-index -1) and mark them `aria-hidden`. The arrow keys must
 * not walk into them, though an explicit focus request still may.
 */
function inHiddenScreen(el: Element) {
    return el.closest("[aria-hidden=\"true\"]") !== null
}

export function isFocusable(el: unknown, root: Element = document.body): el is HTMLElement {
    if (!isElement(el) || !el.matches(FOCUSABLE_SELECTOR)) return false
    if (el.getAttribute("aria-disabled") === "true") return false
    return isRendered(el) && !insideUnfocusableGuide(el, root)
}

/** The active modal (react-native-web renders `aria-modal`), or the document. */
export function getFocusRoot(): HTMLElement {
    const modals = Array.from(document.querySelectorAll<HTMLElement>("[aria-modal=\"true\"]"))
        .filter(isRendered)
    return modals[modals.length - 1] ?? document.body
}

function focusablesIn(scope: Element, root: Element) {
    return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => isFocusable(el, root))
}

function guidesAround(el: Element, until: Element) {
    const found: HTMLElement[] = []
    for (let node = el.parentElement; node && node !== until.parentElement; node = node.parentElement) {
        if (guides.has(node)) found.push(node)
    }
    return found
}

function firstFocusableIn(scope: Element, root: Element) {
    return focusablesIn(scope, root)[0] ?? null
}

function resolveDestination(destinations: readonly unknown[] | undefined, root: Element) {
    for (const destination of destinations ?? []) {
        if (!isElement(destination) || !root.contains(destination)) continue
        if (isFocusable(destination, root)) return destination
        const inner = firstFocusableIn(destination, root)
        if (inner) return inner
    }
    return null
}

///////////////////////////////////////////////////////////////////////////////
// Geometry
///////////////////////////////////////////////////////////////////////////////

type Rect = { left: number; top: number; right: number; bottom: number }

function rectOf(el: Element): Rect {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

function isCandidate(from: Rect, to: Rect, direction: Direction) {
    switch (direction) {
        case "left":
            return (from.right > to.right || from.left >= to.right) && from.left > to.left
        case "right":
            return (from.left < to.left || from.right <= to.left) && from.right < to.right
        case "up":
            return (from.bottom > to.bottom || from.top >= to.bottom) && from.top > to.top
        case "down":
            return (from.top < to.top || from.bottom <= to.top) && from.bottom < to.bottom
    }
}

function inBeam(from: Rect, to: Rect, direction: Direction) {
    if (direction === "left" || direction === "right") {
        return to.bottom > from.top && to.top < from.bottom
    }
    return to.right > from.left && to.left < from.right
}

function majorDistance(from: Rect, to: Rect, direction: Direction) {
    switch (direction) {
        case "left":
            return Math.max(0, from.left - to.right)
        case "right":
            return Math.max(0, to.left - from.right)
        case "up":
            return Math.max(0, from.top - to.bottom)
        case "down":
            return Math.max(0, to.top - from.bottom)
    }
}

function minorDistance(from: Rect, to: Rect, direction: Direction) {
    if (direction === "left" || direction === "right") {
        return Math.abs((from.top + from.bottom) / 2 - (to.top + to.bottom) / 2)
    }
    return Math.abs((from.left + from.right) / 2 - (to.left + to.right) / 2)
}

type Ranked<T> = { element: T; beam: boolean; score: number }

/**
 * The elements lying in `direction`, best first. Only geometry is looked at
 * here (one rect each); whether an element can really take focus is checked
 * by the caller in this order, so usually only for the first one. Checking
 * every focusable on the screen up front cost a style and ancestor walk per
 * element on each key press.
 */
function rankCandidates<T extends Element>(from: Rect, elements: Iterable<T>, direction: Direction): Ranked<T>[] {
    const ranked: Ranked<T>[] = []
    for (const element of elements) {
        const rect = rectOf(element)
        if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue
        if (!isCandidate(from, rect, direction)) continue

        const beam = inBeam(from, rect, direction)
        const major = majorDistance(from, rect, direction)
        const minor = minorDistance(from, rect, direction)
        // Elements sharing the row/column always win over diagonal ones.
        const score = beam ? major * 1000 + minor : 13 * major * major + minor * minor
        ranked.push({ element, beam, score })
    }
    // Stable: equal scores keep document order, as before.
    return ranked.sort((a, b) => Number(b.beam) - Number(a.beam) || a.score - b.score)
}

///////////////////////////////////////////////////////////////////////////////
// Focusing
///////////////////////////////////////////////////////////////////////////////

function isScrollable(el: HTMLElement, axis: "x" | "y") {
    const style = window.getComputedStyle(el)
    const overflow = axis === "x" ? style.overflowX : style.overflowY
    if (overflow !== "auto" && overflow !== "scroll") return false
    return axis === "x" ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1
}

/** The nearest ancestor that scrolls along `axis`, if any. */
export function scrollableAncestor(el: Element, axis: "x" | "y"): HTMLElement | null {
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        if (isScrollable(node, axis)) return node
    }
    return null
}

/** The nearest ancestor that scrolls at all, with the axes it scrolls along. */
export function nearestScroller(el: Element): { node: HTMLElement; x: boolean; y: boolean } | null {
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
        if (!isElement(node)) continue
        const x = isScrollable(node, "x")
        const y = isScrollable(node, "y")
        if (x || y) return { node, x, y }
    }
    return null
}

/** The scroll offset that keeps the span [from, to] at least `margin` inside [start, start + size]. */
function revealSpan(start: number, size: number, from: number, to: number, margin: number) {
    if (from - margin < start) return from - margin
    if (to + margin > start + size) return to + margin - size
    return start
}

/**
 * Scrolls every scrollable ancestor so the element sits away from the edges.
 * Measured against where each scroller is heading rather than where it is,
 * so presses arriving mid-scroll (a held key) extend the movement instead of
 * overshooting it.
 */
export function revealElement(el: HTMLElement) {
    const target = el.getBoundingClientRect()

    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const scrollX = isScrollable(node, "x")
        const scrollY = isScrollable(node, "y")
        if (!scrollX && !scrollY) continue

        const box = node.getBoundingClientRect()
        const heading = scrollTarget(node)
        const next: { x?: number; y?: number } = {}

        if (scrollX) {
            // Where the element sits in the scroller's content.
            const left = target.left - box.left + node.scrollLeft
            const margin = Math.min(box.width * 0.12, 160)
            next.x = revealSpan(heading.x, node.clientWidth, left, left + target.width, margin)
        }
        if (scrollY) {
            const top = target.top - box.top + node.scrollTop
            const margin = Math.min(box.height * 0.2, 200)
            next.y = revealSpan(heading.y, node.clientHeight, top, top + target.height, margin)
        }

        if ((next.x ?? heading.x) !== heading.x || (next.y ?? heading.y) !== heading.y) {
            animateScroll(node, next)
        }
    }
}

export function focusElement(el: HTMLElement, options: { reveal?: boolean } = {}) {
    const root = getFocusRoot()
    const target = isFocusable(el, root) ? el : firstFocusableIn(el, root)
    if (!target) return false

    target.focus({ preventScroll: true })
    if (options.reveal !== false) revealElement(target)
    return document.activeElement === target
}

function readingOrder(a: HTMLElement, b: HTMLElement) {
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    return Math.round(ra.top - rb.top) || Math.round(ra.left - rb.left)
}

/** Focuses something sensible when nothing (or something outside the active modal) has focus. */
export function focusInitial() {
    const root = getFocusRoot()
    const all = focusablesIn(root, root).filter(el => !inHiddenScreen(el))
    if (all.length === 0) return false

    const preferred = all.filter(el => el.hasAttribute(PREFERRED_ATTRIBUTE))
    if (preferred.length > 0) return focusElement(preferred[preferred.length - 1])

    const onScreen = all.filter((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
    })
    return focusElement((onScreen.length > 0 ? onScreen : all).sort(readingOrder)[0])
}

/**
 * The focused element, or null when focus is nowhere the D-pad can see: on
 * <body>, outside the active modal, or left behind on a screen the navigator
 * has since hidden (Back from a tab, a screen under a pushed one). OK must not
 * press a control there, and the arrow keys start over on the visible screen.
 */
export function getFocusedElement() {
    const active = document.activeElement
    if (!isElement(active) || active === document.body) return null
    const root = getFocusRoot()
    return root.contains(active) && !inHiddenScreen(active) ? active : null
}

/**
 * Moves focus one step. Returns false when there is nowhere to go, which
 * mirrors the native engine leaving focus where it is.
 */
export function moveFocus(direction: Direction, options: { reveal?: boolean } = {}): boolean {
    const root = getFocusRoot()
    const current = getFocusedElement()
    if (!current) return focusInitial()

    // A guide trapping this direction keeps the search inside it.
    let scope: Element = root
    for (const guide of guidesAround(current, root)) {
        if (guides.get(guide)?.config.trap[direction]) {
            scope = guide
            break
        }
    }

    const elements: HTMLElement[] = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => el !== current && !current.contains(el))
    // Guides with destinations act as focusable regions even when empty.
    for (const guide of Array.from(scope.querySelectorAll<HTMLElement>(`[${GUIDE_ATTRIBUTE}]`))) {
        if (guides.get(guide)?.config.destinations?.length && !guide.contains(current)) elements.push(guide)
    }

    let best: HTMLElement | null = null
    for (const { element } of rankCandidates(rectOf(current), elements, direction)) {
        const usable = element.hasAttribute(GUIDE_ATTRIBUTE) && !element.matches(FOCUSABLE_SELECTOR)
            ? isRendered(element)
            : isFocusable(element, root)
        if (usable && !inHiddenScreen(element)) {
            best = element
            break
        }
    }
    if (!best) return false

    return focusElement(redirectIntoGuides(best, current, root), options)
}

/** Most single steps a page turn takes; virtualized lists only render a few screens anyway. */
const MAX_PAGE_STEPS = 40

/**
 * Moves focus about one screen up or down inside the vertical scroller
 * around the focused element (CH+/CH- on the remote). Returns false when
 * focus is not in a scroller, so the caller can leave the key alone.
 */
export function pageFocus(direction: "up" | "down"): boolean {
    const start = getFocusedElement()
    if (!start) return false
    const scroller = scrollableAncestor(start, "y")
    if (!scroller) return false

    const startTop = start.getBoundingClientRect().top
    const distance = scroller.clientHeight * 0.8
    let last = start

    for (let i = 0; i < MAX_PAGE_STEPS; i++) {
        if (!moveFocus(direction, { reveal: false })) break
        const next = getFocusedElement()
        if (!next || next === last) break
        if (!scroller.contains(next)) {
            // Stepped out of the list (into a nav bar or header): stay on its edge.
            last.focus({ preventScroll: true })
            break
        }
        last = next
        if (Math.abs(next.getBoundingClientRect().top - startTop) >= distance) break
    }

    if (last !== start) revealElement(last)
    return true
}

/** Applies `destinations` / `autoFocus` of guides that focus is entering. */
function redirectIntoGuides(target: HTMLElement, from: HTMLElement, root: Element): HTMLElement {
    const entering = [target, ...guidesAround(target, root)]
        .filter(node => guides.has(node) && !node.contains(from))
        .reverse()

    for (const guide of entering) {
        const entry = guides.get(guide)!
        const destination = resolveDestination(entry.config.destinations, root)
        if (destination) return destination

        if (entry.config.autoFocus) {
            const last = entry.lastFocused
            if (last && guide.contains(last) && isFocusable(last, root)) return last
            const first = firstFocusableIn(guide, root)
            if (first) return first
        }
    }

    return target
}

/** Remembers the last focused child of every `autoFocus` guide. */
export function trackFocus(el: Element) {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const entry = guides.get(node)
        if (entry?.config.autoFocus && isElement(el)) entry.lastFocused = el
    }
}

export const FOCUS_ATTRIBUTES = {
    guide: GUIDE_ATTRIBUTE,
    preferred: PREFERRED_ATTRIBUTE,
}
