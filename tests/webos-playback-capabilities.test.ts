import assert from "node:assert/strict"
import test from "node:test"
import {
    decidePlayback,
    decodableFormats,
    h264ProfileIdc,
    pixelBitDepth,
    pixelChroma,
    type PlaybackMediaInfo,
} from "../src/lib/webos/playback-capabilities.ts"

// mediaInfo of a 720p H.264 + AAC library file, as /api/v1/mediastream/request returns it.
const H264_FILE: PlaybackMediaInfo = {
    video: { codec: "h264", mimeCodec: "avc1.64001F", width: 1280, height: 720, pixFmt: "yuv420p" },
    audios: [{ codec: "aac", mimeCodec: "mp4a.40.2", channels: 1 }],
}

const withVideo = (video: Partial<NonNullable<PlaybackMediaInfo["video"]>>, audios = H264_FILE.audios): PlaybackMediaInfo => ({
    video: { ...H264_FILE.video!, ...video },
    audios,
})

const everything = { isTypeSupported: () => true }
const nothing = { isTypeSupported: () => false }
const only = (...codecs: string[]) => ({ isTypeSupported: (type: string) => codecs.some(codec => type.includes(codec)) })

test("8-bit H.264 plays directly", () => {
    assert.deepEqual(decidePlayback(H264_FILE, everything), { mode: "direct", reasons: [], audioWarnings: [] })
})

test("H.264 is not probed: the TV decodes it whatever MSE says", () => {
    assert.equal(decidePlayback(H264_FILE, only("mp4a")).mode, "direct")
})

test("10-bit H.264 is transcoded, from the pixel format or the profile byte", () => {
    const byPixFmt = decidePlayback(withVideo({ pixFmt: "yuv420p10le" }), everything)
    assert.equal(byPixFmt.mode, "transcode")
    assert.deepEqual(byPixFmt.reasons, ["10-bit H.264 (Hi10P)"])

    const byProfile = decidePlayback(withVideo({ mimeCodec: "avc1.6E0028", pixFmt: "" }), everything)
    assert.equal(byProfile.mode, "transcode")
    assert.deepEqual(byProfile.reasons, ["10-bit H.264 (Hi10P)"])
})

test("H.264 4:4:4 and 4:2:2 are transcoded", () => {
    assert.deepEqual(decidePlayback(withVideo({ mimeCodec: "avc1.F4001F" }), everything).reasons, ["H.264 High 4:4:4"])
    assert.deepEqual(decidePlayback(withVideo({ mimeCodec: "avc1.64001F", pixFmt: "yuv422p" }), everything).reasons, ["H.264 4:2:2"])
})

test("HEVC Main10 plays directly, 12-bit HEVC does not", () => {
    const main10 = withVideo({ codec: "hevc", mimeCodec: "hvc1.2.4.L153", pixFmt: "yuv420p10le", width: 3840, height: 2160 })
    assert.equal(decidePlayback(main10, nothing).mode, "direct")
    assert.equal(decidePlayback(withVideo({ codec: "hevc", mimeCodec: "hvc1.4.10.L153", pixFmt: "yuv420p12le" }), everything).mode, "transcode")
})

test("Dolby Vision is transcoded only when the TV is known to lack it", () => {
    const dv = withVideo({ codec: "hevc", mimeCodec: "dvhe.05.06", pixFmt: "yuv420p10le" })
    assert.equal(decidePlayback(dv, everything, { dolbyVision: false }).mode, "transcode")
    assert.deepEqual(decidePlayback(dv, everything, { dolbyVision: false }).reasons, ["Dolby Vision"])
    assert.equal(decidePlayback(dv, everything, { dolbyVision: true }).mode, "direct")
    assert.equal(decidePlayback(dv, everything).mode, "direct")
})

test("4K is transcoded on a Full HD TV, not when the panel is unknown", () => {
    const uhd = withVideo({ width: 3840, height: 2160 })
    assert.deepEqual(decidePlayback(uhd, everything, { uhd: false }).reasons, ["3840×2160 video"])
    assert.equal(decidePlayback(uhd, everything, { uhd: true }).mode, "direct")
    assert.equal(decidePlayback(uhd, everything).mode, "direct")
})

test("an unusual codec is transcoded only when the probe refuses it", () => {
    const vc1 = withVideo({ codec: "vc1", mimeCodec: null })
    assert.equal(decidePlayback(vc1, everything).mode, "direct")
    assert.deepEqual(decidePlayback(vc1, nothing).reasons, ["VC1 video"])
})

test("VP9 without a mimeCodec plays directly", () => {
    assert.equal(decidePlayback(withVideo({ codec: "vp9", mimeCodec: null }), nothing).mode, "direct")
})

test("audio the probe refuses is a warning, not a reason to transcode", () => {
    const opus = withVideo({ codec: "vp9", mimeCodec: null }, [
        { codec: "opus", mimeCodec: "opus", channels: 2 },
        { codec: "opus", mimeCodec: "opus", channels: 2 },
    ])
    const decision = decidePlayback(opus, only("vp09"))
    assert.equal(decision.mode, "direct")
    assert.deepEqual(decision.audioWarnings, ["Opus audio may not play on this TV"])
})

test("no media info means direct play", () => {
    assert.equal(decidePlayback(undefined, nothing).mode, "direct")
    assert.equal(decidePlayback({}, nothing).mode, "direct")
})

test("a probe that throws counts as unsupported", () => {
    const throwing = { isTypeSupported: () => { throw new Error("no MSE") } }
    assert.equal(decidePlayback(withVideo({ codec: "vc1" }), throwing).mode, "transcode")
})

test("pixel format and profile helpers", () => {
    assert.equal(pixelBitDepth("yuv420p"), 8)
    assert.equal(pixelBitDepth("yuv420p10le"), 10)
    assert.equal(pixelBitDepth("yuv444p12be"), 12)
    assert.equal(pixelBitDepth(undefined), 8)
    assert.equal(pixelChroma("yuvj420p"), "420")
    assert.equal(pixelChroma("yuv422p10le"), "422")
    assert.equal(pixelChroma("gbrp"), "444")
    assert.equal(h264ProfileIdc("avc1.64001F"), 0x64)
    assert.equal(h264ProfileIdc("avc1.6e0028"), 0x6E)
    assert.equal(h264ProfileIdc("hvc1.2.4.L153"), null)
})

test("decodable formats lists what the probe accepts", () => {
    assert.deepEqual(decodableFormats(only("avc1", "vp09")), ["H.264", "VP9"])
})
