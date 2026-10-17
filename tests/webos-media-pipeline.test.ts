import assert from "node:assert/strict"
import test from "node:test"
import { mediaOptionType, shouldReload } from "../modules/expo-mpv-player/src/web/media-pipeline.ts"

test("a released pipeline is reloaded when the app returns", () => {
    // HAVE_ENOUGH_DATA, NETWORK_IDLE: still there
    assert.equal(shouldReload(4, 1, false), false)
    // the element was emptied (readyState HAVE_NOTHING)
    assert.equal(shouldReload(0, 0, false), true)
    // NETWORK_NO_SOURCE
    assert.equal(shouldReload(1, 3, false), true)
    // a MediaError
    assert.equal(shouldReload(4, 1, true), true)
})

test("mediaOption type carries the start position in milliseconds", () => {
    const type = mediaOptionType(20)
    assert.ok(type.startsWith("video/mp4;mediaOption="))
    assert.match(type, /%22playTime%22/)
    const json = JSON.parse(decodeURI(type.slice("video/mp4;mediaOption=".length))) as { option: { transmission: { playTime: { start: number } } } }
    assert.deepEqual(json, { option: { transmission: { playTime: { start: 20000 } } } })
    const rounded = JSON.parse(decodeURI(mediaOptionType(12.3456).split("=")[1])) as typeof json
    assert.equal(rounded.option.transmission.playTime.start, 12346)
})
