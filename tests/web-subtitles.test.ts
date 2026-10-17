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

test("a separator line holding only whitespace still ends the cue", () => {
    const cues = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nHello\n \n2\n00:00:03,000 --> 00:00:04,000\nWorld\n\t\n")

    assert.deepEqual(cues, [
        { start: 1, end: 2, text: "Hello" },
        { start: 3, end: 4, text: "World" },
    ])
})

test("literal angle brackets are text, tags and entities are not", () => {
    const cues = parseSubtitles([
        "1",
        "00:00:01,000 --> 00:00:02,000",
        "x < y and y > z",
        "",
        "2",
        "00:00:03,000 --> 00:00:04,000",
        "<font color=\"#ff0\">Tom &amp; Jerry</font> <i>&lt;3</i> &amp;lt;",
        "",
        "WEBVTT-style",
        "00:00:05.000 --> 00:00:06.000",
        "<v Frieren><c.yellow>Hi</c></v> <00:00:05.500>there",
    ].join("\n"))

    assert.deepEqual(cues.map(cue => cue.text), ["x < y and y > z", "Tom & Jerry <3 &lt;", "Hi there"])
})

test("srt lines carrying {\\an8} go to the top", () => {
    const cues = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Top line\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an2}Bottom line\n")

    assert.deepEqual(cues, [
        { start: 1, end: 2, text: "Top line", top: true },
        { start: 3, end: 4, text: "Bottom line" },
    ])
})

test("ass lines take the top from their style unless the line overrides it", () => {
    const cues = parseSubtitles([
        "[Script Info]",
        "ScriptType: v4.00+",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, Alignment, MarginL, MarginR, MarginV",
        "Style: Default,Arial,48,&H00FFFFFF,2,10,10,10",
        "Style: Top,Arial,48,&H00FFFFFF,8,10,10,10",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Bottom",
        "Dialogue: 0,0:00:03.00,0:00:04.00,Top,,0,0,0,,From the style",
        "Dialogue: 0,0:00:05.00,0:00:06.00,*Top,,0,0,0,,Starred style name",
        "Dialogue: 0,0:00:07.00,0:00:08.00,Top,,0,0,0,,{\\an2}Moved down",
    ].join("\n"))

    assert.deepEqual(cues.map(cue => [cue.text, cue.top]), [
        ["Bottom", false],
        ["From the style", true],
        ["Starred style name", true],
        ["Moved down", false],
    ])
})

test("ssa v4 styles and \\a overrides use the legacy alignment numbers", () => {
    const cues = parseSubtitles([
        "[Script Info]",
        "ScriptType: v4.00",
        "",
        "[V4 Styles]",
        "Format: Name, Fontname, Alignment",
        "Style: Top,Arial,6",
        "Style: Middle,Arial,10",
        "",
        "[Events]",
        "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: Marked=0,0:00:01.00,0:00:02.00,Top,,0,0,0,,Up",
        "Dialogue: Marked=0,0:00:03.00,0:00:04.00,Middle,,0,0,0,,Centre",
        "Dialogue: Marked=0,0:00:05.00,0:00:06.00,Middle,,0,0,0,,{\\a6}Override up",
    ].join("\n"))

    assert.deepEqual(cues.map(cue => [cue.text, cue.top]), [["Up", true], ["Centre", false], ["Override up", true]])
})
