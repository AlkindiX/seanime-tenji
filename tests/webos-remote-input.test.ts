import assert from "node:assert/strict"
import test from "node:test"
import { createWheelStepper, isDigitEventType, remoteEventType } from "../src/lib/webos/remote-input.ts"

test("LG remote keyCodes map to react-native-tvos event names", () => {
    assert.equal(remoteEventType(403, ""), "red")
    assert.equal(remoteEventType(404, ""), "green")
    assert.equal(remoteEventType(405, ""), "yellow")
    assert.equal(remoteEventType(406, ""), "blue")
    assert.equal(remoteEventType(457, ""), "info")
    assert.equal(remoteEventType(413, ""), "stop")
    assert.equal(remoteEventType(33, "PageUp"), "channelUp")
    assert.equal(remoteEventType(34, "PageDown"), "channelDown")
    assert.equal(remoteEventType(461, "GoBack"), undefined)
})

test("number row and numpad digits are named like Android TV's", () => {
    for (let digit = 0; digit <= 9; digit++) {
        assert.equal(remoteEventType(48 + digit, String(digit)), String(digit))
        assert.equal(remoteEventType(96 + digit, String(digit)), String(digit))
        assert.ok(isDigitEventType(String(digit)))
    }
    assert.ok(!isDigitEventType("red"))
    assert.ok(!isDigitEventType("10"))
})

test("desktop key names stand in when the keyCode is unknown", () => {
    assert.equal(remoteEventType(0, "ArrowDown"), "down")
    assert.equal(remoteEventType(0, "MediaPlayPause"), "playPause")
    assert.equal(remoteEventType(0, "x"), undefined)
})

test("one wheel notch is one focus step", () => {
    const step = createWheelStepper({ step: 100, interval: 120 })
    assert.equal(step(100, 0, 1000), 1)
    assert.equal(step(-100, 0, 2000), -1)
    // Lines (deltaMode 1) count 40 px each.
    assert.equal(step(3, 1, 3000), 1)
})

test("small deltas add up and reversing starts over", () => {
    const step = createWheelStepper({ step: 100, interval: 120 })
    assert.equal(step(60, 0, 0), 0)
    assert.equal(step(60, 0, 10), 1)
    assert.equal(step(-60, 0, 500), 0)
    assert.equal(step(80, 0, 600), 0)
    assert.equal(step(30, 0, 700), 1)
})

test("a fast spin moves at most once per interval and doesn't queue steps", () => {
    const step = createWheelStepper({ step: 100, interval: 120 })
    assert.equal(step(100, 0, 0), 1)
    assert.equal(step(100, 0, 20), 0)
    assert.equal(step(100, 0, 40), 0)
    assert.equal(step(100, 0, 60), 0)
    assert.equal(step(0, 0, 200), 0)
    assert.equal(step(1, 0, 200), 1)
    // The leftover travel was capped below one step.
    assert.equal(step(0.5, 0, 400), 0)
})
