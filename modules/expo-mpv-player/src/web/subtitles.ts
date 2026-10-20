/**
 * Minimal subtitle parsing for the web player (SRT, WebVTT, ASS/SSA).
 *
 * Only dialogue text is kept: ASS styling and positioned typesetting (signs
 * drawn with \pos/\move/\p) need a renderer such as libass, which the web
 * build does not ship.
 */

export type SubtitleCue = {
    start: number
    end: number
    text: string
    /** The line belongs at the top of the screen (ASS \an7-9 or a top-aligned style). */
    top?: boolean
    /** An image subtitle (PGS) instead of text. */
    image?: SubtitleImage
}

/** A bitmap subtitle placed on the video's own pixel grid (`canvasWidth` × `canvasHeight`). */
export type SubtitleImage = {
    src: string
    x: number
    y: number
    width: number
    height: number
    canvasWidth: number
    canvasHeight: number
    /** The part of the image shown at (x, y), when the stream crops it. */
    crop?: { x: number; y: number; width: number; height: number }
}

function parseTimestamp(value: string): number {
    const parts = value.trim().replace(",", ".").split(":")
    let seconds = 0
    for (const part of parts) {
        seconds = seconds * 60 + Number.parseFloat(part)
    }
    return Number.isFinite(seconds) ? seconds : 0
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: "\"", apos: "'", lrm: "\u200e", rlm: "\u200f" }

/** Decodes the HTML entities WebVTT allows (and SRT files carry), each once. */
function decodeEntities(text: string) {
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
        if (name[0] === "#") {
            const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
        }
        return ENTITIES[name.toLowerCase()] ?? whole
    })
}

/**
 * Removes SRT/WebVTT tags (<i>, <font …>, <c.x>, <v Name>, <00:01.000>…)
 * and ASS override blocks, then decodes entities. Other "<" and ">" are
 * text ("x < y and y > z").
 */
export function stripMarkup(text: string) {
    return decodeEntities(text
        .replace(/<\/?(?:b|i|u|s|font|c|v|lang|ruby|rt|span)(?=[\s.>])[^>]*>/gi, "")
        .replace(/<\d[\d:.]*>/g, "")
        .replace(/\{[^}]*\}/g, ""))
        .trim()
}

/** ASS \an7-9 (numpad), or legacy SSA \a5-7: the line goes at the top of the screen. */
function overrideIsTop(raw: string): boolean | undefined {
    const an = /\\an([1-9])/.exec(raw)
    if (an) return Number(an[1]) >= 7
    const legacy = /\\a(\d{1,2})(?!\d)/.exec(raw)
    if (legacy) return legacyAlignmentIsTop(Number(legacy[1]))
    return undefined
}

/** SSA v4 alignment: 1-3 bottom, 5-7 top, 9-11 middle. */
function legacyAlignmentIsTop(value: number) {
    return value >= 5 && value <= 7
}

function parseSrtOrVtt(content: string): SubtitleCue[] {
    const cues: SubtitleCue[] = []
    // A separator line may hold stray spaces or tabs.
    const blocks = content.replace(/\r/g, "").split(/\n(?:[ \t]*\n)+/)

    for (const block of blocks) {
        const lines = block.split("\n")
        const timingIndex = lines.findIndex(line => line.includes("-->"))
        if (timingIndex < 0) continue

        const [startRaw, endRaw] = lines[timingIndex].split("-->")
        const raw = lines.slice(timingIndex + 1).join("\n")
        const text = stripMarkup(raw)
        if (!text) continue

        const cue: SubtitleCue = {
            start: parseTimestamp(startRaw),
            // VTT cue settings follow the end time ("00:01.000 line:0")
            end: parseTimestamp(endRaw.trim().split(/\s+/)[0]),
            text,
        }
        // SRT files converted from ASS keep {\an8} for lines meant for the top.
        if (overrideIsTop(raw)) cue.top = true
        cues.push(cue)
    }

    return cues.sort((a, b) => a.start - b.start)
}

/** Style name -> whether its Alignment puts lines at the top. */
export type AssTopStyles = Map<string, boolean>

/** The styles of an ASS/SSA script, or of the header an MKV track keeps in CodecPrivate. */
export function parseAssTopStyles(content: string): AssTopStyles {
    const topStyles: AssTopStyles = new Map()
    let section = ""
    let styleFormat: string[] = []
    // SSA v4 ([V4 Styles]) numbers alignments differently from ASS ([V4+ Styles]).
    let legacyAlignment = false

    for (const rawLine of content.replace(/\r/g, "").split("\n")) {
        const line = rawLine.trim()
        if (line.startsWith("[")) {
            section = line.toLowerCase()
            legacyAlignment = section === "[v4 styles]"
            continue
        }
        if (section !== "[v4+ styles]" && section !== "[v4 styles]") continue

        const lower = line.toLowerCase()
        if (lower.startsWith("format:")) {
            styleFormat = line.slice(7).split(",").map(field => field.trim().toLowerCase())
        } else if (lower.startsWith("style:") && styleFormat.length > 0) {
            const values = line.slice(6).split(",").map(value => value.trim())
            const name = values[styleFormat.indexOf("name")]
            const alignment = Number(values[styleFormat.indexOf("alignment")])
            if (name !== undefined && Number.isFinite(alignment)) {
                topStyles.set(name, legacyAlignment ? legacyAlignmentIsTop(alignment) : alignment >= 7)
            }
        }
    }

    return topStyles
}

function parseAss(content: string): SubtitleCue[] {
    const cues: SubtitleCue[] = []
    const topStyles = parseAssTopStyles(content)
    let section = ""
    let format: string[] = []

    for (const rawLine of content.replace(/\r/g, "").split("\n")) {
        const line = rawLine.trim()
        if (line.startsWith("[")) {
            section = line.toLowerCase()
            continue
        }
        const lower = line.toLowerCase()
        if (section !== "[events]") continue

        if (lower.startsWith("format:")) {
            format = line.slice(7).split(",").map(field => field.trim().toLowerCase())
            continue
        }
        if (!lower.startsWith("dialogue:") || format.length === 0) continue

        // Text is the last field and may itself contain commas.
        const values = line.slice(9).split(",")
        const fields = values.slice(0, format.length - 1)
        fields.push(values.slice(format.length - 1).join(","))
        const field = (name: string) => fields[format.indexOf(name)]?.trim() ?? ""

        const cue = assDialogueCue(field("text"), field("style"), parseTimestamp(field("start")), parseTimestamp(field("end")), topStyles)
        if (cue) cues.push(cue)
    }

    return cues.sort((a, b) => a.start - b.start)
}

/**
 * One ASS dialogue text as a cue, or null for an empty line or one that only
 * makes sense positioned (signs drawn with \pos/\move/\p).
 */
export function assDialogueCue(raw: string, style: string, start: number, end: number, topStyles: AssTopStyles): SubtitleCue | null {
    if (/\\(pos|move)\(|\\p[1-9]/.test(raw)) return null

    const text = raw
        .replace(/\\N/gi, "\n")
        .replace(/\\h/g, " ")
        .replace(/\{[^}]*\}/g, "")
        .trim()
    if (!text) return null

    return {
        start,
        end,
        text,
        // An override in the line wins over its style's alignment.
        top: overrideIsTop(raw) ?? topStyles.get(style.trim().replace(/^\*/, "")) ?? false,
    }
}

export function isAssScript(content: string) {
    return /^\s*\[Script Info\]/im.test(content) || /^\s*\[Events\]/im.test(content)
}

export function parseSubtitles(content: string): SubtitleCue[] {
    if (isAssScript(content)) {
        return parseAss(content)
    }
    return parseSrtOrVtt(content)
}

/** Cues showing at `time`, newest last. */
export function activeCues(cues: readonly SubtitleCue[], time: number): SubtitleCue[] {
    const active: SubtitleCue[] = []
    for (const cue of cues) {
        if (cue.start > time) break
        if (cue.end > time) active.push(cue)
    }
    return active
}
