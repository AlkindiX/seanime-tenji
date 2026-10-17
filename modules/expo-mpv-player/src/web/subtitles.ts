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
    /** ASS \an7-\an9: the line belongs at the top of the screen. */
    top?: boolean
}

function parseTimestamp(value: string): number {
    const parts = value.trim().replace(",", ".").split(":")
    let seconds = 0
    for (const part of parts) {
        seconds = seconds * 60 + Number.parseFloat(part)
    }
    return Number.isFinite(seconds) ? seconds : 0
}

function stripMarkup(text: string) {
    return text
        .replace(/<[^>]+>/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .trim()
}

function parseSrtOrVtt(content: string): SubtitleCue[] {
    const cues: SubtitleCue[] = []
    const blocks = content.replace(/\r/g, "").split(/\n{2,}/)

    for (const block of blocks) {
        const lines = block.split("\n")
        const timingIndex = lines.findIndex(line => line.includes("-->"))
        if (timingIndex < 0) continue

        const [startRaw, endRaw] = lines[timingIndex].split("-->")
        const text = stripMarkup(lines.slice(timingIndex + 1).join("\n"))
        if (!text) continue

        cues.push({
            start: parseTimestamp(startRaw),
            // VTT cue settings follow the end time ("00:01.000 line:0")
            end: parseTimestamp(endRaw.trim().split(/\s+/)[0]),
            text,
        })
    }

    return cues.sort((a, b) => a.start - b.start)
}

function parseAss(content: string): SubtitleCue[] {
    const cues: SubtitleCue[] = []
    let inEvents = false
    let format: string[] = []

    for (const rawLine of content.replace(/\r/g, "").split("\n")) {
        const line = rawLine.trim()
        if (line.startsWith("[")) {
            inEvents = line.toLowerCase() === "[events]"
            continue
        }
        if (!inEvents) continue

        if (line.toLowerCase().startsWith("format:")) {
            format = line.slice(7).split(",").map(field => field.trim().toLowerCase())
            continue
        }
        if (!line.toLowerCase().startsWith("dialogue:") || format.length === 0) continue

        // Text is the last field and may itself contain commas.
        const values = line.slice(9).split(",")
        const fields = values.slice(0, format.length - 1)
        fields.push(values.slice(format.length - 1).join(","))
        const field = (name: string) => fields[format.indexOf(name)]?.trim() ?? ""

        const raw = field("text")
        if (/\\(pos|move)\(|\\p[1-9]/.test(raw)) continue

        const text = raw
            .replace(/\\N/gi, "\n")
            .replace(/\\h/g, " ")
            .replace(/\{[^}]*\}/g, "")
            .trim()
        if (!text) continue

        cues.push({
            start: parseTimestamp(field("start")),
            end: parseTimestamp(field("end")),
            text,
            top: /\\an[789]/.test(raw),
        })
    }

    return cues.sort((a, b) => a.start - b.start)
}

export function parseSubtitles(content: string): SubtitleCue[] {
    if (/^\s*\[Script Info\]/im.test(content) || /^\s*\[Events\]/im.test(content)) {
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
