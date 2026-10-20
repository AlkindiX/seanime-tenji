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
    assert.deepEqual(toLines([event]), [{
        trackNumber: 4,
        start: 1.5,
        end: 3.5,
        text: event.text,
        style: "Default",
        ass: { layer: undefined, name: undefined, marginL: undefined, marginR: undefined, marginV: undefined, effect: undefined },
    }])
})

test("ASS lines keep the packet fields libass reads", () => {
    const [line] = toLines([{
        ...event,
        extraData: { style: "Sign", layer: "2", name: "Actor", marginl: "10", marginr: "20", marginv: "30", effect: "Banner;5" },
    }])
    assert.equal(line.style, "Sign")
    assert.deepEqual(line.ass, { layer: "2", name: "Actor", marginL: "10", marginR: "20", marginV: "30", effect: "Banner;5" })
})

test("PGS events become image lines placed on the video", () => {
    const base = { trackNumber: 5, text: "iVBORw0KGgo", startTime: 2000, codecID: "S_HDMV/PGS" }
    const [placed] = toLines([{
        ...base,
        duration: 1500,
        extraData: { type: "image", width: "400", height: "80", x: "760", y: "950", canvas_width: "1920", canvas_height: "1080" },
    }])
    assert.deepEqual(placed, {
        trackNumber: 5,
        start: 2,
        end: 3.5,
        text: "",
        image: {
            src: "data:image/png;base64,iVBORw0KGgo",
            x: 760, y: 950, width: 400, height: 80, canvasWidth: 1920, canvasHeight: 1080, crop: undefined,
        },
    })

    // No duration: shown for a while. No position: centred near the bottom.
    const [unplaced] = toLines([{ ...base, duration: 0, extraData: { type: "image", width: "400", height: "80" } }])
    assert.equal(unplaced.end, 7)
    assert.equal(unplaced.image?.x, 760)
    assert.equal(unplaced.image?.y, 1080 * 0.95 - 80)

    // Without a size or data there is nothing to show.
    assert.deepEqual(toLines([{ ...base, duration: 1000, extraData: { type: "image" } }]), [])
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
    // Positioned typesetting is left to libass; the text fallback drops it.
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
