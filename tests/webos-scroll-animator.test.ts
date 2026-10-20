import assert from "node:assert/strict"
import test from "node:test"

// A controllable clock and frame queue for the animator.
let now = 0
let frames: Array<(time: number) => void> = []
let timers: Array<{ at: number; run: () => void }> = []
Object.assign(globalThis, {
    performance: { now: () => now },
    requestAnimationFrame: (callback: (time: number) => void) => frames.push(callback),
    setTimeout: (run: () => void, ms: number) => timers.push({ at: now + ms, run }),
})

const { animateScroll, scrollTarget } = await import("../src/lib/webos/scroll-animator.ts")

type FakeScroller = { scrollLeft: number; scrollTop: number; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number; isConnected: boolean }

function scroller(): FakeScroller {
    let left = 0
    return {
        // Browsers round scroll offsets to whole pixels.
        get scrollLeft() { return left },
        set scrollLeft(value: number) { left = Math.round(Math.min(Math.max(0, value), 3000)) },
        scrollTop: 0,
        scrollWidth: 4000,
        clientWidth: 1000,
        scrollHeight: 1000,
        clientHeight: 1000,
        isConnected: true,
    }
}

/** Runs frames 16 ms apart, and any timer that came due. */
function runFrames(count: number) {
    for (let i = 0; i < count; i++) {
        now += 16
        const due = frames
        frames = []
        for (const frame of due) frame(now)
        const ready = timers.filter(timer => timer.at <= now)
        timers = timers.filter(timer => timer.at > now)
        for (const timer of ready) timer.run()
    }
}

test("a scroll eases all the way to its target, despite rounding", () => {
    const node = scroller()
    animateScroll(node as unknown as HTMLElement, { x: 500 })
    runFrames(5)
    assert.ok(node.scrollLeft > 200 && node.scrollLeft < 500, `part way after 80 ms, at ${node.scrollLeft}`)
    runFrames(60)
    assert.equal(node.scrollLeft, 500)
})

test("pressing again mid-scroll extends the movement instead of restarting it", () => {
    const node = scroller()
    animateScroll(node as unknown as HTMLElement, { x: 300 })
    runFrames(4)
    const before = node.scrollLeft
    // A held key: the next target is measured from where it's heading, and it never goes back.
    animateScroll(node as unknown as HTMLElement, { x: scrollTarget(node as unknown as HTMLElement).x + 300 })
    let previous = before
    for (let i = 0; i < 60; i++) {
        runFrames(1)
        assert.ok(node.scrollLeft >= previous, "moves one way only")
        previous = node.scrollLeft
    }
    assert.equal(node.scrollLeft, 600)
})

test("the wheel or a drag scrolling the same list takes over", () => {
    const node = scroller()
    animateScroll(node as unknown as HTMLElement, { x: 800 })
    runFrames(3)
    node.scrollLeft = 50
    runFrames(30)
    assert.equal(node.scrollLeft, 50)
})

test("targets are kept within the list", () => {
    const node = scroller()
    animateScroll(node as unknown as HTMLElement, { x: 99_999 })
    assert.equal(scrollTarget(node as unknown as HTMLElement).x, 3000)
    runFrames(120)
    assert.equal(node.scrollLeft, 3000)
})

test("without frames (a stalled page) it jumps to the target", () => {
    const node = scroller()
    animateScroll(node as unknown as HTMLElement, { x: 400 })
    // No frame runs; only the clock and timers move.
    now += 250
    const ready = timers.filter(timer => timer.at <= now)
    timers = timers.filter(timer => timer.at > now)
    frames = []
    for (const timer of ready) timer.run()
    assert.equal(node.scrollLeft, 400)
})
