/**
 * The browser's audio tracks (HTMLMediaElement.audioTracks, which webOS
 * exposes for its own player) matched with the file's tracks as the server
 * describes them, and the way out of a track the TV plays no sound for.
 * Kept apart from the player so the node tests can check it.
 */
import type { MpvSourceAudioTrack } from "../MpvPlayer.types"

export type BrowserAudioTrackInfo = { label: string; language: string }

/** Two- and three-letter codes of the languages anime releases carry, for comparing tags. */
const LANGUAGE_CODES: Record<string, string> = {
    jpn: "ja",
    eng: "en",
    ger: "de",
    deu: "de",
    fre: "fr",
    fra: "fr",
    spa: "es",
    ita: "it",
    por: "pt",
    rus: "ru",
    chi: "zh",
    zho: "zh",
    kor: "ko",
    ara: "ar",
    pol: "pl",
    tur: "tr",
    hin: "hi",
    ind: "id",
    tha: "th",
    vie: "vi",
}

/** "jpn", "ja", "ja-JP" -> "ja"; "und" and empty -> "". */
export function languageKey(tag: string | undefined) {
    const primary = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0]
    if (!primary || primary === "und") return ""
    return LANGUAGE_CODES[primary] ?? primary
}

function sameTitle(a: string | undefined, b: string | undefined) {
    return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * For each browser track, the index of the file's track it is, or null.
 * In file order when the counts match and nothing contradicts it; otherwise
 * by title and language, in order. webOS leaves out tracks it can't decode
 * (TrueHD, marked `unlisted`), so those are set aside when the browser has
 * fewer tracks. webOS 24 lists the default track first, so file order
 * without a language to confirm it is only trusted when the default track
 * is the first one anyway.
 */
export function matchAudioTracks(browser: readonly BrowserAudioTrackInfo[], known: readonly MpvSourceAudioTrack[]): Array<number | null> {
    const candidates = known
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => browser.length >= known.length || !track.unlisted)

    if (browser.length === candidates.length) {
        let contradicts = false
        let confirmed = false
        browser.forEach((track, i) => {
            const a = languageKey(track.language)
            const b = languageKey(candidates[i].track.language)
            if (a !== "" && b !== "") {
                if (a === b) confirmed = true
                else contradicts = true
            }
        })
        const defaultFirst = candidates.findIndex(({ track }) => track.default) <= 0
        if (!contradicts && (confirmed || defaultFirst)) return candidates.map(({ index }) => index)
    }

    const used = new Set<number>()
    return browser.map((track) => {
        const language = languageKey(track.language)
        const pick = (matches: (candidate: MpvSourceAudioTrack) => boolean) => {
            const found = candidates.find(({ track: candidate, index }) => !used.has(index) && matches(candidate))
            return found ? found.index : null
        }
        const index = pick(candidate => sameTitle(track.label, candidate.title)
            && (language === "" || languageKey(candidate.language) === "" || languageKey(candidate.language) === language))
            ?? (language ? pick(candidate => languageKey(candidate.language) === language) : null)
        if (index !== null) used.add(index)
        return index
    })
}

/**
 * The browser track to switch to when the enabled one is a track the TV is
 * known to play no sound for: one in the same language if there is one, a
 * track the TV plays before one it may not. Null when nothing is better, or
 * when no track says it is enabled (then nothing tells what is playing).
 */
export function audioFallbackIndex(
    enabled: number,
    mapping: ReadonlyArray<number | null>,
    known: readonly MpvSourceAudioTrack[],
): number | null {
    const current = enabled >= 0 ? mapping[enabled] : null
    const currentTrack = current !== null && current !== undefined ? known[current] : undefined
    if (currentTrack?.support !== "broken") return null

    const language = languageKey(currentTrack.language)
    let best: number | null = null
    let bestRank = Infinity
    for (let index = 0; index < mapping.length; index++) {
        const knownIndex = mapping[index]
        if (knownIndex === null || index === enabled) continue
        const track = known[knownIndex]
        if (track.support === "broken") continue
        const rank = (language !== "" && languageKey(track.language) === language ? 0 : 2) + (track.support === "plays" ? 0 : 1)
        if (rank < bestRank) {
            best = index
            bestRank = rank
        }
    }
    return best
}

/** The title to show for a browser track: its own label and what it is ("Japanese · FLAC 5.1"). */
export function audioTrackTitle(label: string | undefined, known: MpvSourceAudioTrack | undefined) {
    const base = label || known?.title || undefined
    if (!known) return base
    const what = known.support === "broken" ? `${known.codec}, may be silent on this TV` : known.codec
    return base ? `${base} · ${what}` : what
}
