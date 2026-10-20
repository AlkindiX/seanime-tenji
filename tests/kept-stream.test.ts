import assert from "node:assert/strict"
import test from "node:test"
import { classifyKeptStreamProbe, createKeptStreamStore, type KeptStreamEnd, type KeptStreamEndReason } from "../src/lib/player/kept-stream.ts"

const IDLE_MS = 30 * 60_000

function fakeClock() {
    let now = 1_000
    let nextId = 1
    const timers = new Map<number, { at: number; callback: () => void }>()
    return {
        clock: {
            now: () => now,
            setTimeout: (callback: () => void, ms: number) => {
                const id = nextId++
                timers.set(id, { at: now + ms, callback })
                return id
            },
            clearTimeout: (id: unknown) => {
                timers.delete(id as number)
            },
        },
        /** Moves time on, running the timers that fall due (a suspended TV runs none: `runTimers` false). */
        advance(ms: number, runTimers = true) {
            now += ms
            if (!runTimers) return
            for (const [id, timer] of [...timers]) {
                if (timer.at > now) continue
                timers.delete(id)
                timer.callback()
            }
        },
        pending: () => timers.size,
    }
}

function fakeSession(name: string, calls: string[]) {
    return {
        name,
        terminate: () => calls.push(`terminate ${name}`),
        forget: () => calls.push(`forget ${name}`),
    }
}

function setup() {
    const time = fakeClock()
    const calls: string[] = []
    const ends: Array<[string, KeptStreamEnd, KeptStreamEndReason]> = []
    const store = createKeptStreamStore<{ url: string }, ReturnType<typeof fakeSession>>(IDLE_MS, time.clock, (kept, how, reason) => {
        ends.push([kept.playbackId, how, reason])
    })
    const attach = (playbackId: string, episodeNumber = 5) => store.attach({
        playbackId,
        mediaId: 21,
        episodeNumber,
        source: { url: `http://server/stream?id=${playbackId}` },
        session: fakeSession(playbackId, calls),
    })
    return { store, time, calls, ends, attach }
}

test("a stream the player left is kept for that episode, from where it was", () => {
    const { store, attach, calls } = setup()
    attach("a")
    // Not offered while a player shows it.
    assert.equal(store.find(21, 5), null)

    assert.equal(store.leave("a", 754.2), true)
    const kept = store.find(21, 5)
    assert.equal(kept?.playbackId, "a")
    assert.equal(kept?.position, 754.2)
    assert.equal(kept?.source.url, "http://server/stream?id=a")
    assert.equal(store.find(21, 6), null)
    assert.equal(store.find(22, 5), null)
    assert.deepEqual(calls, [])
})

test("picking the kept stream up again keeps its session and position until the player leaves again", () => {
    const { store, attach, calls, time } = setup()
    attach("a")
    store.leave("a", 100)
    attach("a")
    assert.equal(store.current()?.leftAt, null)
    assert.equal(store.current()?.position, 100)
    // Watching it again stops the idle timer.
    assert.equal(time.pending(), 0)
    store.leave("a", 160)
    assert.equal(store.find(21, 5)?.position, 160)
    assert.deepEqual(calls, [])
})

test("another stream replaces the kept one without telling the server", () => {
    const { store, attach, calls, ends } = setup()
    attach("a")
    store.leave("a", 100)
    attach("b", 6)
    assert.equal(store.current()?.playbackId, "b")
    assert.equal(store.current()?.position, 0)
    assert.deepEqual(calls, ["forget a"])
    assert.deepEqual(ends, [["a", "forget", "replaced"]])
})

test("a stream nobody comes back to ends after the idle time", () => {
    const { store, attach, calls, time, ends } = setup()
    attach("a")
    store.leave("a", 100)
    time.advance(IDLE_MS - 1)
    assert.ok(store.find(21, 5))
    time.advance(1)
    assert.equal(store.current(), null)
    assert.deepEqual(calls, ["terminate a"])
    assert.deepEqual(ends, [["a", "terminate", "idle"]])
})

test("an idle stream is ended when looked up even if its timer never ran", () => {
    const { store, attach, calls, time } = setup()
    attach("a")
    store.leave("a", 100)
    // A suspended TV runs no timers.
    time.advance(IDLE_MS + 5_000, false)
    assert.equal(store.find(21, 5), null)
    assert.deepEqual(calls, ["terminate a"])
    assert.equal(time.pending(), 0)
})

test("ending a stream: terminate tells the server, forget doesn't, and only the named one ends", () => {
    const { store, attach, calls } = setup()
    attach("a")
    store.leave("a", 100)
    assert.equal(store.end("forget", "other"), false)
    assert.ok(store.current())
    assert.equal(store.end("terminate", "a"), true)
    assert.equal(store.current(), null)
    assert.equal(store.end("terminate"), false)

    attach("b")
    store.leave("b", 3)
    assert.equal(store.end("forget"), true)
    assert.deepEqual(calls, ["terminate a", "forget b"])
})

test("a player leaving a stream that already ended keeps nothing", () => {
    const { store, attach, calls } = setup()
    attach("a")
    // The server stopped it while the player was open.
    store.end("forget", "a")
    assert.equal(store.leave("a", 100), false)
    assert.equal(store.current(), null)
    assert.deepEqual(calls, ["forget a"])
})

test("a nonsense position is kept as the start", () => {
    const { store, attach } = setup()
    attach("a")
    store.leave("a", Number.NaN)
    assert.equal(store.find(21, 5)?.position, 0)
    attach("a")
    store.leave("a", -3)
    assert.equal(store.find(21, 5)?.position, 0)
})

test("listeners hear every change", () => {
    const { store, attach } = setup()
    let changes = 0
    const unsubscribe = store.subscribe(() => changes++)
    attach("a")
    store.leave("a", 1)
    store.end("terminate")
    unsubscribe()
    attach("b")
    assert.equal(changes, 3)
})

test("the server's answer for the kept stream's URL", () => {
    assert.equal(classifyKeptStreamProbe({ status: 200 }), "alive")
    assert.equal(classifyKeptStreamProbe({ status: 206 }), "alive")
    // Replaced by another stream, or none at all.
    assert.equal(classifyKeptStreamProbe({ status: 404 }), "gone")
    assert.equal(classifyKeptStreamProbe({ status: 500 }), "gone")
    // An expired link.
    assert.equal(classifyKeptStreamProbe({ status: 403 }), "gone")
    assert.equal(classifyKeptStreamProbe("unreachable"), "gone")
    // No answer in time, or one CORS hid: the server may well still serve it.
    assert.equal(classifyKeptStreamProbe("no-answer"), "unknown")
})
