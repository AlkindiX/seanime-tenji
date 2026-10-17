import assert from "node:assert/strict"
import test from "node:test"
import { findPlatformBack } from "../src/lib/webos/webos-platform.ts"

test("platformBack is taken from webOSSystem when it has one", () => {
    const calls: string[] = []
    const webOSSystem = {
        platformBack(this: unknown) {
            calls.push(this === webOSSystem ? "webOSSystem" : "unbound")
        },
    }
    const back = findPlatformBack({ webOSSystem, PalmSystem: { platformBack: () => calls.push("PalmSystem") } })
    back?.()
    assert.deepEqual(calls, ["webOSSystem"])
})

test("PalmSystem.platformBack is used when webOSSystem lacks it", () => {
    const calls: string[] = []
    const PalmSystem = {
        platformBack(this: unknown) {
            calls.push(this === PalmSystem ? "PalmSystem" : "unbound")
        },
    }
    const back = findPlatformBack({ webOSSystem: {}, PalmSystem })
    back?.()
    assert.deepEqual(calls, ["PalmSystem"])
})

test("no platformBack outside a TV", () => {
    assert.equal(findPlatformBack({}), null)
    assert.equal(findPlatformBack({ webOSSystem: {}, PalmSystem: {} }), null)
})
