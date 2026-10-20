/**
 * Scrubbing with a TV remote, without React or the DOM so it can be unit
 * tested in Node.
 *
 * Left/right move a pending target instead of seeking the video on every
 * press or key repeat: each seek of a torrent stream fetches from a new spot
 * over the network and restarts the server's subtitle reading. The target is
 * seeked once, when the presses stop (or at once on OK), and Back drops it.
 */

export type ScrubDirection = -1 | 1

export const SCRUB = {
    /** Quiet time after the last press, or the release of a held key, before the seek goes out. */
    commitDelayMs: 700,
    /** How often a held key moves the target. */
    holdTickMs: 200,
    /** A held key moves at least this much per tick, even with a shorter press step. */
    holdMinStepSec: 5,
    /** A held key keeps its first speed for this long... */
    holdRampDelayMs: 600,
    /** ...then speeds up over this long to its top speed. */
    holdRampMs: 2400,
    /** At top speed a held key crosses the whole episode in about this long. */
    fullSweepMs: 8000,
    /** Without a duration, top speed is this many first-speed steps per tick. */
    unknownDurationMaxScale: 4,
    /** A seek that never lands stops showing its target after this long. */
    settleMaxMs: 8000,
    /** Playback this close to a committed target has arrived there. */
    arriveSec: 1.5,
    /** Playback this far from where it was at the commit, but not at the target, was seeked elsewhere. */
    strayJumpSec: 3,
} as const

/** Keeps a target inside the episode: from 0 to a second before the end. */
export function clampScrubTarget(seconds: number, duration: number) {
    const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
    if (!(duration > 0)) return time
    return Math.min(time, Math.max(0, duration - 1))
}

/**
 * Seconds one tick of a held key moves the target after `heldMs` of holding:
 * the press step (at least `holdMinStepSec`) at first, growing to a top speed
 * scaled to the duration, so a long movie and a short episode both take about
 * `fullSweepMs` to cross at full speed.
 */
export function holdStep(baseStep: number, heldMs: number, duration: number) {
    const first = Math.max(SCRUB.holdMinStepSec, baseStep > 0 ? baseStep : 0)
    const top = duration > 0
        ? Math.max(first, duration * SCRUB.holdTickMs / SCRUB.fullSweepMs)
        : first * SCRUB.unknownDurationMaxScale
    const ramp = Math.min(1, Math.max(0, (heldMs - SCRUB.holdRampDelayMs) / SCRUB.holdRampMs))
    return Math.round(first + (top - first) * ramp)
}

function clock(seconds: number) {
    const total = Math.floor(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    return `${m}:${String(s).padStart(2, "0")}`
}

/** "+30s", "-1:30", "+1:02:05": how far the target is from where scrubbing started. */
export function formatScrubOffset(seconds: number) {
    const sign = seconds < 0 ? "-" : "+"
    const abs = Math.abs(Math.round(seconds))
    return abs < 60 ? `${sign}${abs}s` : `${sign}${clock(abs)}`
}

export type ScrubSnapshot = {
    /** Where playback was (or was headed) when scrubbing started. */
    origin: number
    /** Where the seek goes. */
    target: number
    /** `target - origin`. */
    offset: number
    /** The duration is unknown: the target only has an offset and is seeked relatively. */
    relative: boolean
    /** The seek went out and playback hasn't reached the target yet. */
    committed: boolean
}

export type ScrubClock = {
    now: () => number
    setTimeout: (callback: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
}

export type ScrubOptions = {
    getTime: () => number
    getDuration: () => number
    /** The press step in seconds (the player's seek setting). */
    getStep: () => number
    seekTo: (seconds: number) => void
    seekRelative: (seconds: number) => void
    /** Called whenever the target moves; the player keeps its controls up meanwhile. */
    onActivity?: () => void
    clock?: ScrubClock
}

export type ScrubController = {
    getSnapshot: () => ScrubSnapshot | null
    subscribe: (listener: () => void) => () => void
    /** True while a target waits to be seeked. */
    isPending: () => boolean
    /** One press: moves the target a step and seeks once the presses stop. */
    nudge: (direction: ScrubDirection) => void
    /** A key is held: moves the target on a timer, faster the longer it is held. */
    hold: (direction: ScrubDirection) => void
    /** The held key was let go: seeks once nothing else follows. */
    release: () => void
    /** The pointer is on the timeline at this time: shows it without seeking. */
    preview: (seconds: number) => void
    /** Seeks to the pending target now. False when there is none. */
    commit: () => boolean
    /** Drops the pending target without seeking. False when there is none. */
    cancel: () => boolean
    /** Playback time, so a committed target stops showing once playback gets there. */
    observeTime: (seconds: number) => void
    /** Stops everything without seeking (the episode changed or the player closed). */
    reset: () => void
}

const defaultClock: ScrubClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createScrubController(options: ScrubOptions): ScrubController {
    const time = options.clock ?? defaultClock
    const listeners = new Set<() => void>()
    let snapshot: ScrubSnapshot | null = null
    let commitTimer: unknown = null
    let holdTimer: unknown = null
    let settleTimer: unknown = null
    let holdDirection: ScrubDirection | 0 = 0
    let holdStartedAt = 0
    /** Playback time when the last target was seeked. */
    let committedFrom = 0

    function publish(next: ScrubSnapshot | null) {
        snapshot = next
        for (const listener of Array.from(listeners)) listener()
    }

    function clearCommit() {
        if (commitTimer === null) return
        time.clearTimeout(commitTimer)
        commitTimer = null
    }

    function clearSettle() {
        if (settleTimer === null) return
        time.clearTimeout(settleTimer)
        settleTimer = null
    }

    function stopHold() {
        holdDirection = 0
        if (holdTimer === null) return
        time.clearTimeout(holdTimer)
        holdTimer = null
    }

    /** The pending snapshot, or a new one starting from playback (or from a seek still on its way). */
    function pending(): ScrubSnapshot {
        if (snapshot && !snapshot.committed) return snapshot
        const duration = options.getDuration()
        const relative = !(duration > 0)
        const from = snapshot?.committed ? snapshot.target : options.getTime()
        const origin = relative ? Math.max(0, from || 0) : clampScrubTarget(from, duration)
        clearSettle()
        return { origin, target: origin, offset: 0, relative, committed: false }
    }

    function moveTo(target: number) {
        const current = pending()
        const next = current.relative
            ? Math.max(0, target)
            : clampScrubTarget(target, options.getDuration())
        if (snapshot === current && next === current.target) return
        publish({ ...current, target: next, offset: next - current.origin })
        options.onActivity?.()
    }

    function armCommit() {
        clearCommit()
        commitTimer = time.setTimeout(() => {
            commitTimer = null
            commit()
        }, SCRUB.commitDelayMs)
    }

    function step() {
        const value = options.getStep()
        return value > 0 ? value : 1
    }

    function commit() {
        stopHold()
        clearCommit()
        const current = snapshot
        if (!current || current.committed) return false

        if (current.offset === 0) {
            publish(null)
            return true
        }
        // Seek before replacing the snapshot: nothing reads `current` after `snapshot` changes
        // (Terser once folded such a copy into reads of the updated variable).
        if (current.relative) {
            options.seekRelative(current.offset)
            publish(null)
            return true
        }

        committedFrom = options.getTime()
        options.seekTo(current.target)
        // Keep showing the target until playback gets there: a torrent seek can take a while.
        publish({ ...current, committed: true })
        settleTimer = time.setTimeout(() => {
            settleTimer = null
            if (snapshot?.committed) publish(null)
        }, SCRUB.settleMaxMs)
        return true
    }

    function cancel() {
        stopHold()
        clearCommit()
        if (!snapshot || snapshot.committed) return false
        publish(null)
        return true
    }

    function tick(direction: ScrubDirection) {
        if (holdDirection !== direction) return
        const current = pending()
        const held = time.now() - holdStartedAt
        moveTo(current.target + direction * holdStep(step(), held, options.getDuration()))
        holdTimer = time.setTimeout(() => {
            holdTimer = null
            tick(direction)
        }, SCRUB.holdTickMs)
    }

    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        isPending: () => snapshot !== null && !snapshot.committed,
        nudge(direction) {
            stopHold()
            const current = pending()
            moveTo(current.target + direction * step())
            armCommit()
        },
        hold(direction) {
            if (holdDirection === direction) return
            stopHold()
            clearCommit()
            holdDirection = direction
            holdStartedAt = time.now()
            tick(direction)
        },
        release() {
            if (holdDirection === 0) return
            stopHold()
            if (snapshot && !snapshot.committed) armCommit()
        },
        preview(seconds) {
            stopHold()
            clearCommit()
            if (!(options.getDuration() > 0) || !Number.isFinite(seconds)) return
            moveTo(Math.round(seconds))
        },
        commit,
        cancel,
        observeTime(seconds) {
            if (!snapshot?.committed) return
            const arrived = Math.abs(seconds - snapshot.target) <= SCRUB.arriveSec
            // Something else seeked meanwhile (a number key, skip intro): stop showing the target.
            const strayed = Math.abs(seconds - committedFrom) > SCRUB.strayJumpSec
            if (!arrived && !strayed) return
            clearSettle()
            publish(null)
        },
        reset() {
            stopHold()
            clearCommit()
            clearSettle()
            if (snapshot) publish(null)
        },
    }
}
