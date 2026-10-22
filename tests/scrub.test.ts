import assert from "node:assert/strict"
import test from "node:test"
import {
    clampScrubTarget,
    createScrubController,
    formatScrubOffset,
    holdStep,
    SCRUB,
    type ScrubClock,
} from "../src/lib/player/scrub.ts"

/** Timers that only run when the test moves the clock. */
function fakeClock() {
    let now = 0
    let nextId = 0
    const timers = new Map<number, { at: number; callback: () => void }>()
    const clock: ScrubClock = {
        now: () => now,
        setTimeout(callback, ms) {
            const id = ++nextId
            timers.set(id, { at: now + ms, callback })
            return id
        },
        clearTimeout(handle) {
            timers.delete(handle as number)
        },
    }
    const advance = (ms: number) => {
        const end = now + ms
        for (;;) {
            let first: [number, { at: number; callback: () => void }] | null = null
            for (const entry of timers) {
                if (entry[1].at <= end && (!first || entry[1].at < first[1].at)) first = entry
            }
            if (!first) break
            timers.delete(first[0])
            now = first[1].at
            first[1].callback()
        }
        now = end
    }
    return { clock, advance }
}

function setup({ time = 100, duration = 1440, step = 10 } = {}) {
    const { clock, advance } = fakeClock()
    const seeks: Array<["to" | "by", number]> = []
    const player = { time, duration }
    const scrub = createScrubController({
        getTime: () => player.time,
        getDuration: () => player.duration,
        getStep: () => step,
        seekTo: seconds => seeks.push(["to", seconds]),
        seekRelative: seconds => seeks.push(["by", seconds]),
        clock,
    })
    return { scrub, seeks, advance, player }
}

test("presses move the target and seek once when they stop", () => {
    const { scrub, seeks, advance } = setup()
    scrub.nudge(1)
    advance(300)
    scrub.nudge(1)
    advance(300)
    scrub.nudge(1)
    assert.deepEqual(seeks, [])
    assert.equal(scrub.getSnapshot()?.target, 130)
    assert.equal(scrub.getSnapshot()?.offset, 30)
    assert.ok(scrub.isPending())

    advance(SCRUB.commitDelayMs - 1)
    assert.deepEqual(seeks, [])
    advance(1)
    assert.deepEqual(seeks, [["to", 130]])
    assert.ok(!scrub.isPending())
})

test("OK seeks at once; with nothing pending it does nothing", () => {
    const { scrub, seeks, advance } = setup()
    assert.equal(scrub.commit(), false)
    scrub.nudge(-1)
    assert.equal(scrub.commit(), true)
    assert.deepEqual(seeks, [["to", 90]])
    advance(SCRUB.commitDelayMs * 2)
    assert.deepEqual(seeks, [["to", 90]])
})

test("going back and forth to where it started doesn't seek", () => {
    const { scrub, seeks, advance } = setup()
    scrub.nudge(1)
    scrub.nudge(-1)
    advance(SCRUB.commitDelayMs)
    assert.deepEqual(seeks, [])
    assert.equal(scrub.getSnapshot(), null)
})

test("the target stays between the start and a second before the end", () => {
    const start = setup({ time: 4 })
    start.scrub.nudge(-1)
    assert.equal(start.scrub.getSnapshot()?.target, 0)

    const end = setup({ time: 1435, duration: 1440 })
    end.scrub.nudge(1)
    assert.equal(end.scrub.getSnapshot()?.target, 1439)

    assert.equal(clampScrubTarget(-5, 100), 0)
    assert.equal(clampScrubTarget(500, 100), 99)
    assert.equal(clampScrubTarget(500, 0), 500)
    assert.equal(clampScrubTarget(Number.NaN, 100), 0)
})

test("without a duration the presses add up to one relative seek", () => {
    const { scrub, seeks, advance } = setup({ duration: 0 })
    scrub.nudge(1)
    scrub.nudge(1)
    assert.equal(scrub.getSnapshot()?.relative, true)
    advance(SCRUB.commitDelayMs)
    assert.deepEqual(seeks, [["by", 20]])
    assert.equal(scrub.getSnapshot(), null)
})

test("Back drops the target without seeking", () => {
    const { scrub, seeks, advance } = setup()
    scrub.nudge(1)
    assert.equal(scrub.cancel(), true)
    advance(SCRUB.commitDelayMs * 2)
    assert.deepEqual(seeks, [])
    assert.equal(scrub.cancel(), false)
})

test("holding moves faster the longer it lasts and seeks once after the release", () => {
    const { scrub, seeks, advance } = setup({ time: 0, duration: 1440, step: 3 })
    scrub.hold(1)
    // The first tick moves at once, at the hold's first speed.
    assert.equal(scrub.getSnapshot()?.target, SCRUB.holdMinStepSec)

    const moves: number[] = []
    let last = scrub.getSnapshot()!.target
    for (let i = 0; i < 20; i++) {
        advance(SCRUB.holdTickMs)
        const target = scrub.getSnapshot()!.target
        moves.push(target - last)
        last = target
    }
    assert.ok(moves[0] < moves[moves.length - 1], "speeds up")
    assert.equal(moves[moves.length - 1], 1440 * SCRUB.holdTickMs / SCRUB.fullSweepMs, "top speed scales with the duration")
    assert.deepEqual(seeks, [])

    scrub.release()
    const target = scrub.getSnapshot()!.target
    advance(SCRUB.holdTickMs * 3)
    assert.equal(scrub.getSnapshot()?.target, target, "stops moving once let go")
    advance(SCRUB.commitDelayMs)
    assert.deepEqual(seeks, [["to", target]])
})

test("hold speed: press step first, capped top speed", () => {
    assert.equal(holdStep(3, 0, 1440), SCRUB.holdMinStepSec)
    assert.equal(holdStep(30, 0, 1440), 30)
    assert.equal(holdStep(3, 60_000, 1440), 36)
    assert.equal(holdStep(3, 60_000, 7200), 180)
    // A short clip never goes below the first speed.
    assert.equal(holdStep(10, 60_000, 120), 10)
    // Without a duration it tops out at a few steps.
    assert.equal(holdStep(10, 60_000, 0), 10 * SCRUB.unknownDurationMaxScale)
})

test("a committed target shows until playback gets there, and the next presses start from it", () => {
    const { scrub, seeks, advance } = setup({ time: 100 })
    scrub.nudge(1)
    scrub.commit()
    assert.deepEqual(seeks, [["to", 110]])
    assert.equal(scrub.getSnapshot()?.committed, true)

    // Playback hasn't moved yet; the next press adds to the seek on its way.
    scrub.nudge(1)
    assert.equal(scrub.getSnapshot()?.origin, 110)
    assert.equal(scrub.getSnapshot()?.target, 120)
    scrub.commit()

    scrub.observeTime(100.5)
    assert.equal(scrub.getSnapshot()?.committed, true)
    scrub.observeTime(120.2)
    assert.equal(scrub.getSnapshot(), null)

    // One that never lands stops showing after a while.
    scrub.nudge(1)
    scrub.commit()
    advance(SCRUB.settleMaxMs)
    assert.equal(scrub.getSnapshot(), null)
})

test("a committed target stops showing when something else seeks", () => {
    const { scrub, player } = setup({ time: 100 })
    scrub.nudge(1)
    scrub.commit()
    // Playback moving on a little before the seek starts is not a jump.
    scrub.observeTime(101)
    assert.equal(scrub.getSnapshot()?.committed, true)
    // A number key sent playback to 50% instead.
    player.time = 720
    scrub.observeTime(720)
    assert.equal(scrub.getSnapshot(), null)
})

test("the pointer previews without seeking until it is let go", () => {
    const { scrub, seeks, advance } = setup()
    scrub.preview(600.4)
    scrub.preview(700.6)
    advance(SCRUB.commitDelayMs * 2)
    assert.deepEqual(seeks, [])
    assert.equal(scrub.getSnapshot()?.target, 701)
    scrub.commit()
    assert.deepEqual(seeks, [["to", 701]])

    // No duration, no position on the timeline.
    const unknown = setup({ duration: 0 })
    unknown.scrub.preview(50)
    assert.equal(unknown.scrub.getSnapshot(), null)
})

test("listeners hear every change; reset clears without seeking", () => {
    const { scrub, seeks } = setup()
    let calls = 0
    const unsubscribe = scrub.subscribe(() => calls++)
    scrub.nudge(1)
    scrub.nudge(1)
    assert.equal(calls, 2)
    scrub.reset()
    assert.equal(calls, 3)
    assert.equal(scrub.getSnapshot(), null)
    assert.deepEqual(seeks, [])
    unsubscribe()
    scrub.nudge(1)
    assert.equal(calls, 3)
})

test("offsets read like the player's clock", () => {
    assert.equal(formatScrubOffset(30), "+30s")
    assert.equal(formatScrubOffset(-5), "-5s")
    assert.equal(formatScrubOffset(0), "+0s")
    assert.equal(formatScrubOffset(90), "+1:30")
    assert.equal(formatScrubOffset(-3725), "-1:02:05")
})
