import assert from "node:assert/strict"
import test from "node:test"
import { levelsAboveHeight, loadFailure, mediaOptionType, shouldReload } from "../modules/expo-mpv-player/src/web/media-pipeline.ts"

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

test("levels taller than the cap are dropped, highest index first", () => {
    // the server's transcode: original 4K, a 4K rendition, then 240p to 1440p
    assert.deepEqual(levelsAboveHeight([240, 360, 480, 720, 1080, 1440, 2160, 2160], 1088), [7, 6, 5])
    assert.deepEqual(levelsAboveHeight([2160, 720, 1080], 1088), [0])
    assert.deepEqual(levelsAboveHeight([720, 1080], 1088), [])
    // nothing fits: keep them all rather than leave hls.js with no level
    assert.deepEqual(levelsAboveHeight([2160, 1440], 1088), [])
})

test("a source that failed to load is a server or network failure only when the probe says so", () => {
    assert.equal(loadFailure({ status: 200 }), null)
    assert.equal(loadFailure({ status: 206 }), null)
    assert.equal(loadFailure("unknown"), null)
    assert.equal(loadFailure({ status: 401 })?.code, 2)
    assert.match(loadFailure({ status: 403 })!.error, /refused access.*HTTP 403/)
    assert.match(loadFailure({ status: 404 })!.error, /could not find.*HTTP 404/)
    assert.match(loadFailure({ status: 502 })!.error, /HTTP 502/)
    assert.deepEqual(loadFailure("unreachable"), { error: "The TV could not reach the server for this video", code: 2 })
})
