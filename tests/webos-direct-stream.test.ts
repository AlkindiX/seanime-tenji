import assert from "node:assert/strict"
import test from "node:test"
import { assDialogueCue, parseAssStyles } from "../modules/expo-mpv-player/src/web/subtitles.ts"
import { describeStreamCodecs, eventsOf, toLines } from "../src/lib/player/direct-stream-format.ts"

const event = {
    trackNumber: 4,
    text: "Hello{\\i1}there{\\i0}\\Nsecond row",
    startTime: 1500,
    duration: 2000,
    codecID: "S_TEXT/ASS",
    extraData: { style: "Default" },
}

test("subtitle events become lines in seconds with their style", () => {
    assert.deepEqual(toLines([event]), [
        { trackNumber: 4, start: 1.5, end: 3.5, text: event.text, style: "Default" },
    ])
})

test("subtitle batches of another playback are dropped", () => {
    assert.deepEqual(eventsOf({ events: [event], playbackId: "a", generationId: 1, seekTime: 0 }, "a"), [event])
    assert.deepEqual(eventsOf({ events: [event], playbackId: "b", generationId: 1, seekTime: 0 }, "a"), [])
    assert.deepEqual(eventsOf([event], "a"), [event])
    assert.deepEqual(eventsOf(event, "a"), [event])
    assert.deepEqual(eventsOf(null, "a"), [])
})

test("streamed ASS lines keep their rows and take the style's alignment", () => {
    const styles = parseAssStyles([
        "[V4+ Styles]",
        "Format: Name, Fontname, Alignment",
        "Style: Default,Arial,2",
        "Style: Top,Arial,8",
    ].join("\n"))

    assert.deepEqual(assDialogueCue(event.text, 1.5, 3.5, "Default", styles), { start: 1.5, end: 3.5, text: "Hellothere\nsecond row", top: false })
    assert.equal(assDialogueCue("Sign", 0, 1, "Top", styles)?.top, true)
    assert.equal(assDialogueCue("{\\an8}Up here", 0, 1, "Default", styles)?.top, true)
    // Positioned typesetting needs a renderer the web build doesn't have.
    assert.equal(assDialogueCue("{\\pos(10,10)}Sign", 0, 1, "Default", styles), null)
})

test("stream codecs name the audio an LG TV may not play", () => {
    const codecs = describeStreamCodecs({
        duration: 1,
        timecodeScale: 1000000,
        videoTracks: [{ number: 1, uid: 1, type: "video", codecID: "V_MPEGH/ISO/HEVC", default: true, forced: false, enabled: true, video: { PixelWidth: 1920, PixelHeight: 1080 } }],
        audioTracks: [
            { number: 2, uid: 2, type: "audio", codecID: "A_FLAC", default: true, forced: false, enabled: true },
            { number: 3, uid: 3, type: "audio", codecID: "A_AAC", default: false, forced: false, enabled: true },
        ],
    })

    assert.deepEqual(codecs, { video: "HEVC", resolution: "1920×1080", audio: ["FLAC", "AAC"], riskyAudio: ["FLAC"] })
    assert.deepEqual(describeStreamCodecs(undefined), { video: undefined, resolution: undefined, audio: [], riskyAudio: [] })
})
