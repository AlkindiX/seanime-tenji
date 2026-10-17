import assert from "node:assert/strict"
import test from "node:test"
import { activeCues, parseSubtitles } from "../modules/expo-mpv-player/src/web/subtitles.ts"

test("srt cues keep their timing and lines", () => {
    const cues = parseSubtitles([
        "2",
        "00:00:05,000 --> 00:00:09,500",
        "Second <i>line</i>",
        "",
        "1",
        "00:00:01,000 --> 00:00:04,000",
        "First line",
        "continues here",
        "",
    ].join("\r\n"))

    assert.deepEqual(cues, [
        { start: 1, end: 4, text: "First line\ncontinues here" },
        { start: 5, end: 9.5, text: "Second line" },
    ])
})

test("vtt cue settings after the end time are ignored", () => {
    const cues = parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.500 line:0 align:start\nHello\n")

    assert.deepEqual(cues, [{ start: 1, end: 2.5, text: "Hello" }])
})

test("ass dialogue keeps commas, skips typesetting and marks top lines", () => {
    const cues = parseSubtitles([
        "[Script Info]",
        "ScriptType: v4.00+",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Well, {\\i1}hello{\\i0}\\Nthere",
        "Dialogue: 0,0:00:02.00,0:00:04.00,Sign,,0,0,0,,{\\pos(320,50)}A sign",
        "Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\an8}Up top",
    ].join("\n"))

    assert.deepEqual(cues, [
        { start: 1, end: 3, text: "Well, hello\nthere", top: false },
        { start: 5, end: 6, text: "Up top", top: true },
    ])
})

test("active cues are the ones spanning the time", () => {
    const cues = parseSubtitles("1\n00:00:01,000 --> 00:00:05,000\nA\n\n2\n00:00:04,000 --> 00:00:06,000\nB\n")

    assert.deepEqual(activeCues(cues, 4.5).map(cue => cue.text), ["A", "B"])
    assert.deepEqual(activeCues(cues, 5).map(cue => cue.text), ["B"])
    assert.deepEqual(activeCues(cues, 6), [])
})
