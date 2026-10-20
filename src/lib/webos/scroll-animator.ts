/**
 * Smooth scrolling for the D-pad and the Magic Remote, retargetable mid-way.
 *
 * `scrollBy({ behavior: "smooth" })` restarts its easing on every call, from
 * wherever the previous animation had got to. With a held arrow key (a call
 * every 30-50 ms) or quick taps, lists stuttered and overshot, then settled
 * on the focused card: the shaking. Here each scroller has one target that
 * key presses move, and every frame closes a fixed share of the remaining
 * distance, so repeated presses only extend one continuous movement.
 */

type Animation = {
    x: number
    y: number
    time: number
    /** What this animation last wrote, to notice someone else scrolling. */
    wroteX: number
    wroteY: number
}

/** Each frame covers 1 - e^(-dt / τ) of the distance left: about 90 % in 0.2 s. */
const TIME_CONSTANT_MS = 85
/** Closer than this, the target is simply set. */
const SETTLE_PX = 0.5
/** Browsers round scroll offsets; a bigger difference means the wheel or a drag moved it. */
const FOREIGN_SCROLL_PX = 3

/** Without a frame by then (a stalled or throttled page), the scroll is done at once. */
const STALL_MS = 200

const running = new Map<HTMLElement, Animation>()
let frame: number | null = null
let stallTimer: ReturnType<typeof setTimeout> | null = null
let lastFrameAt = 0

/** Frames stopped coming: put every scroller where it was heading, so focus is never left off-screen. */
function finishStalled() {
    stallTimer = null
    if (running.size === 0 || performance.now() - lastFrameAt < STALL_MS) return
    for (const [node, animation] of Array.from(running)) {
        node.scrollLeft = animation.x
        node.scrollTop = animation.y
    }
    running.clear()
}

function maxScroll(node: HTMLElement) {
    return {
        x: Math.max(0, node.scrollWidth - node.clientWidth),
        y: Math.max(0, node.scrollHeight - node.clientHeight),
    }
}

function clamp(value: number, max: number) {
    return Math.min(Math.max(0, value), max)
}

/** Where `node` is heading: the running animation's target, or where it is. */
export function scrollTarget(node: HTMLElement) {
    const animation = running.get(node)
    return animation ? { x: animation.x, y: animation.y } : { x: node.scrollLeft, y: node.scrollTop }
}

/** Scrolls `node` smoothly to `target` (axes left out keep their current target). */
export function animateScroll(node: HTMLElement, target: { x?: number; y?: number }) {
    const max = maxScroll(node)
    const current = scrollTarget(node)
    const x = clamp(target.x ?? current.x, max.x)
    const y = clamp(target.y ?? current.y, max.y)

    const animation = running.get(node)
    if (animation) {
        animation.x = x
        animation.y = y
    } else {
        if (Math.abs(x - node.scrollLeft) < SETTLE_PX && Math.abs(y - node.scrollTop) < SETTLE_PX) return
        running.set(node, { x, y, time: performance.now(), wroteX: node.scrollLeft, wroteY: node.scrollTop })
    }
    if (frame === null) {
        lastFrameAt = performance.now()
        frame = requestAnimationFrame(step)
    }
    stallTimer ??= setTimeout(finishStalled, STALL_MS)
}

/** Stops `node` where it is (a drag or the wheel takes over). */
export function stopScroll(node: HTMLElement) {
    running.delete(node)
}

/** At least a pixel a frame: browsers round offsets, so smaller steps would never land. */
function approach(from: number, to: number, share: number) {
    const distance = to - from
    if (Math.abs(distance) <= 1) return to
    const step = distance * share
    return from + (Math.abs(step) < 1 ? Math.sign(distance) : step)
}

function step(now: number) {
    frame = null
    lastFrameAt = performance.now()
    for (const [node, animation] of Array.from(running)) {
        const moved = Math.abs(node.scrollLeft - animation.wroteX) > FOREIGN_SCROLL_PX
            || Math.abs(node.scrollTop - animation.wroteY) > FOREIGN_SCROLL_PX
        if (!node.isConnected || moved) {
            running.delete(node)
            continue
        }

        // A frame late after the app was hidden doesn't jump.
        const elapsed = Math.min(now - animation.time, 100)
        animation.time = now
        const share = 1 - Math.exp(-elapsed / TIME_CONSTANT_MS)

        const x = approach(node.scrollLeft, animation.x, share)
        const y = approach(node.scrollTop, animation.y, share)
        if (x !== node.scrollLeft) node.scrollLeft = x
        if (y !== node.scrollTop) node.scrollTop = y
        animation.wroteX = node.scrollLeft
        animation.wroteY = node.scrollTop

        // Done when it got there, or when the browser won't go further (content shrank).
        const stuck = Math.abs(node.scrollLeft - x) > 1 || Math.abs(node.scrollTop - y) > 1
        if ((x === animation.x && y === animation.y) || stuck) running.delete(node)
    }
    if (running.size > 0) {
        frame = requestAnimationFrame(step)
        stallTimer ??= setTimeout(finishStalled, STALL_MS)
    }
}
