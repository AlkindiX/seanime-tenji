/**
 * The Seanime server's stream auto-select, redone on the client so the webOS
 * build can see which release it would pick before asking for it: the same
 * searches, filters and scores (internal/torrents/autoselect in Seanime
 * 3.10.4). When that release has audio the TV can't play and a comparable one
 * doesn't, the TV starts the other one itself.
 *
 * No react-native imports, so the node tests can load it.
 */
import type { SearchTorrent_Variables } from "@/api/generated/endpoint.types"
import type {
    AL_BaseAnime,
    Anime_AutoSelectPreference,
    Anime_AutoSelectProfile,
    Habari_Metadata,
    HibikeTorrent_AnimeTorrent,
    Torrent_SearchData,
} from "@/api/generated/types"
import { releaseAudioProblem } from "./release-audio.ts"

export type AutoSelectProfile = Omit<Anime_AutoSelectProfile, "dbId" | "multipleAudioPreference" | "multipleSubsPreference" | "batchPreference"
    | "bestReleasePreference" | "requireLanguage" | "requireCodec" | "requireSource"> & {
    multipleAudioPreference?: Anime_AutoSelectPreference
    multipleSubsPreference?: Anime_AutoSelectPreference
    batchPreference?: Anime_AutoSelectPreference
    bestReleasePreference?: Anime_AutoSelectPreference
    requireLanguage?: boolean
    requireCodec?: boolean
    requireSource?: boolean
}

type Parsed = Pick<Habari_Metadata, "video_resolution" | "release_group" | "video_term" | "audio_term" | "source" | "language" | "subtitles">

const SCORE = {
    resolutionBase: 100,
    resolutionDecay: 10,
    providerBase: 5,
    providerDecay: 1,
    releaseGroupBase: 50,
    releaseGroupDecay: 5,
    codecBase: 40,
    codecDecay: 5,
    sourceBase: 30,
    sourceDecay: 5,
    languageBase: 20,
    languageDecay: 2,
    multiAudio: 15,
    multiSubs: 10,
    batch: 20,
    bestRelease: 20,
}

/** What the server uses when no auto-select profile was saved: the stream settings' resolution. */
export function defaultAutoSelectProfile(preferredResolution: string | null | undefined): AutoSelectProfile {
    return { resolutions: [preferredResolution || "1080p"], minSeeders: 0 }
}

const equalFold = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()

function isTokenChar(char: string) {
    return (char >= "a" && char <= "z") || (char >= "0" && char <= "9")
}

/** `term` in `lowerValue` with no letter or digit right before or after it. */
export function containsBoundedTerm(lowerValue: string, term: string) {
    const lowerTerm = term.trim().toLowerCase()
    if (!lowerTerm) return false
    let from = 0
    while (true) {
        const index = lowerValue.indexOf(lowerTerm, from)
        if (index === -1) return false
        const end = index + lowerTerm.length
        const left = index === 0 || !isTokenChar(lowerValue[index - 1])
        const right = end === lowerValue.length || !isTokenChar(lowerValue[end])
        if (left && right) return true
        from = index + 1
    }
}

function splitAndClean(items: readonly string[] | undefined) {
    return (items ?? []).flatMap(item => item.split(",").map(part => part.trim()))
}

function containsMultiOrDual(terms: readonly string[] | undefined) {
    return (terms ?? []).some((term) => {
        const lower = term.toLowerCase()
        return lower.includes("multi") || lower.includes("dual") || lower.includes("dub")
    })
}

function checkPreference(condition: boolean, preference: Anime_AutoSelectPreference | undefined) {
    if (preference === "only" && !condition) return false
    if (preference === "never" && condition) return false
    return true
}

/** "1.5 GB", "700MiB" -> bytes; null when it isn't a size. */
export function parseSize(value: string | undefined): number | null {
    let text = (value ?? "").trim().toUpperCase()
    if (!text) return null
    text = text.replace(/IB/g, "B")
    const units: Array<[string, number]> = [["TB", 1024 ** 4], ["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024], ["B", 1]]
    let multiplier = 1
    for (const [unit, size] of units) {
        if (text.endsWith(unit)) {
            multiplier = size
            text = text.slice(0, -unit.length)
            break
        }
    }
    const number = Number(text.trim())
    return Number.isFinite(number) && text.trim() !== "" ? Math.trunc(number * multiplier) : null
}

type Candidate<T> = {
    torrent: T
    parsed: Parsed
    lowerName: string
    priority: number
    bonus: number
}

function matchesAny(values: readonly string[] | undefined, lowerName: string, term: string, boundedMinLength = 0) {
    if ((values ?? []).some(value => equalFold(value, term))) return true
    return term.length > boundedMinLength && containsBoundedTerm(lowerName, term)
}

function passesFilters<T extends HibikeTorrent_AnimeTorrent>(candidate: Candidate<T>, profile: AutoSelectProfile) {
    const { torrent, parsed, lowerName } = candidate
    if ((profile.excludeTerms ?? []).some(term => lowerName.includes(term.toLowerCase()))) return false
    if (profile.bestReleasePreference === "only" && !torrent.isBestRelease) return false
    if (profile.bestReleasePreference === "never" && torrent.isBestRelease) return false

    const languages = splitAndClean(profile.preferredLanguages)
    if (profile.requireLanguage && languages.length > 0
        && !languages.some(language => matchesAny(parsed.language, lowerName, language, 3))) return false

    if ((profile.minSeeders ?? 0) > 0 && torrent.seeders < (profile.minSeeders ?? 0)) return false

    const minSize = parseSize(profile.minSize)
    const maxSize = parseSize(profile.maxSize)
    if (minSize !== null && torrent.size > 0 && torrent.size < minSize) return false
    if (maxSize !== null && torrent.size > 0 && torrent.size > maxSize) return false

    const codecs = splitAndClean(profile.preferredCodecs)
    if (profile.requireCodec && codecs.length > 0 && !codecs.some(codec => matchesAny(parsed.video_term, lowerName, codec))) return false

    const sources = splitAndClean(profile.preferredSources)
    if (profile.requireSource && sources.length > 0 && !sources.some(source => matchesAny(parsed.source, lowerName, source))) return false

    return checkPreference(containsMultiOrDual(parsed.audio_term), profile.multipleAudioPreference)
        && checkPreference(containsMultiOrDual(parsed.subtitles), profile.multipleSubsPreference)
        && checkPreference(!!torrent.isBatch, profile.batchPreference)
}

/** Points for the first entry of `list` (a comma list per entry) that matches, fewer for later entries. */
function listScore(list: readonly string[] | undefined, base: number, decay: number, matches: (term: string) => boolean) {
    const entries = list ?? []
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].split(",").some(term => matches(term.trim()))) return base - i * decay
    }
    return 0
}

function score<T extends HibikeTorrent_AnimeTorrent>(candidate: Candidate<T>, profile: AutoSelectProfile) {
    const { torrent, parsed, lowerName } = candidate
    let priority = 0
    let bonus = 0

    const resolutionIndex = (profile.resolutions ?? []).findIndex(resolution => equalFold(parsed.video_resolution, resolution))
    if (resolutionIndex >= 0) priority += SCORE.resolutionBase - resolutionIndex * SCORE.resolutionDecay
    const providerIndex = (profile.providers ?? []).findIndex(provider => equalFold(torrent.provider, provider))
    if (providerIndex >= 0) priority += SCORE.providerBase - providerIndex * SCORE.providerDecay
    const groupIndex = (profile.releaseGroups ?? []).findIndex(group => equalFold(parsed.release_group, group))
    if (groupIndex >= 0) priority += SCORE.releaseGroupBase - groupIndex * SCORE.releaseGroupDecay

    priority += listScore(profile.preferredCodecs, SCORE.codecBase, SCORE.codecDecay, codec =>
        (parsed.video_term ?? []).some(term => equalFold(term, codec))
        || (parsed.audio_term ?? []).some(term => equalFold(term, codec))
        || containsBoundedTerm(lowerName, codec))
    priority += listScore(profile.preferredSources, SCORE.sourceBase, SCORE.sourceDecay, source =>
        (parsed.source ?? []).some(term => equalFold(term, source)) || containsBoundedTerm(lowerName, source))
    priority += listScore(profile.preferredLanguages, SCORE.languageBase, SCORE.languageDecay, language =>
        (parsed.language ?? []).some(term => equalFold(term, language)) || containsBoundedTerm(lowerName, language))

    const sign = (preference: Anime_AutoSelectPreference | undefined) => preference === "prefer" ? 1 : preference === "avoid" ? -1 : 0
    if (containsMultiOrDual(parsed.audio_term)) bonus += sign(profile.multipleAudioPreference) * SCORE.multiAudio
    if (containsMultiOrDual(parsed.subtitles)) bonus += sign(profile.multipleSubsPreference) * SCORE.multiSubs
    if (torrent.isBatch) bonus += sign(profile.batchPreference) * SCORE.batch
    const isBestRelease = torrent.isBestRelease && (torrent.seeders === -1 || torrent.seeders > 2)
    if (isBestRelease) bonus += sign(profile.bestReleasePreference) * SCORE.bestRelease

    return { priority, bonus }
}

export type RankedTorrent<T> = { torrent: T; parsed: Parsed; score: number }

/**
 * The search results the server would consider, best first: the profile's
 * filters, then its scores, then seeders. With `cached` (debrid), cached
 * releases scoring at least 70% of the best come first and the other cached
 * ones last, as the server orders them for a debrid stream.
 */
export function rankLikeAutoSelect<T extends HibikeTorrent_AnimeTorrent>(
    torrents: readonly T[],
    metadata: Readonly<Record<string, Parsed | undefined>>,
    profile: AutoSelectProfile,
    cached?: ReadonlySet<string>,
): RankedTorrent<T>[] {
    const candidates = torrents
        .map((torrent): Candidate<T> => ({
            torrent,
            parsed: (torrent.infoHash ? metadata[torrent.infoHash] : undefined) ?? {},
            lowerName: torrent.name.toLowerCase(),
            priority: 0,
            bonus: 0,
        }))
        .filter(candidate => passesFilters(candidate, profile))

    for (const candidate of candidates) Object.assign(candidate, score(candidate, profile))
    // Array.prototype.sort is stable, like the server's SortStableFunc.
    candidates.sort((a, b) => (b.priority - a.priority) || (b.bonus - a.bonus) || (b.torrent.seeders - a.torrent.seeders))

    const ranked = candidates.map(candidate => ({ torrent: candidate.torrent, parsed: candidate.parsed, score: candidate.priority + candidate.bonus }))
    if (!cached) return ranked

    const isCached = (entry: RankedTorrent<T>) => !!entry.torrent.infoHash && cached.has(entry.torrent.infoHash.toLowerCase())
    const threshold = Math.trunc((ranked[0]?.score ?? 0) * 0.7)
    return [
        ...ranked.filter(entry => isCached(entry) && entry.score >= threshold),
        ...ranked.filter(entry => !isCached(entry)),
        ...ranked.filter(entry => isCached(entry) && entry.score < threshold),
    ]
}

/** A finished series (not a movie) that ended over two weeks ago: the server looks for batches first. */
export function shouldSearchBatch(media: Pick<AL_BaseAnime, "status" | "format" | "endDate"> | undefined, now = new Date()) {
    if (!media || media.format === "MOVIE" || media.status !== "FINISHED") return false
    const end = media.endDate
    if (end?.year && end.month && end.day) {
        const ended = Date.UTC(end.year, end.month - 1, end.day)
        if (ended > now.getTime() - 14 * 24 * 60 * 60 * 1000) return false
    }
    return true
}

/** Enough batch results to go with: one well seeded, or more than two. */
export function isUsableBatchResult(torrents: readonly HibikeTorrent_AnimeTorrent[] | undefined) {
    if (!torrents?.length) return false
    return Math.max(...torrents.map(torrent => torrent.seeders)) >= 15 || torrents.length > 2
}

/** The title the server searches with on providers that can't do a smart search. */
export function cleanMediaTitle(title: string) {
    return title.replace(/ - /g, " ").replace(/[:!';*()[\]]/g, "").trim()
}

export type AutoSelectProvider = { id: string; canSmartSearch: boolean }

export type AutoSelectSearch = (variables: SearchTorrent_Variables) => Promise<Torrent_SearchData | undefined>

export type AutoSelectResults = {
    torrents: HibikeTorrent_AnimeTorrent[]
    metadata: Record<string, Parsed | undefined>
    /** Info hashes (lower case) the debrid service has cached. */
    cached: Set<string>
}

/**
 * The searches the server's auto-select runs: each provider (the profile's,
 * at most three, or the default one) for the profile's resolutions in order
 * until one has results, batches first for a finished series (with single
 * episodes added), single episodes otherwise.
 */
export async function searchLikeAutoSelect(params: {
    search: AutoSelectSearch
    providers: readonly AutoSelectProvider[]
    media: AL_BaseAnime
    episodeNumber: number
    profile: AutoSelectProfile
    now?: Date
}): Promise<AutoSelectResults> {
    const { search, media, episodeNumber, profile } = params
    const resolutions = profile.resolutions?.length ? profile.resolutions : [""]
    const searchBatch = shouldSearchBatch(media, params.now)
    const title = media.title?.romaji || media.title?.english || media.title?.userPreferred || ""
    const results: AutoSelectResults = { torrents: [], metadata: {}, cached: new Set() }

    const collect = (data: Torrent_SearchData | undefined) => {
        for (const [hash, value] of Object.entries(data?.torrentMetadata ?? {})) results.metadata[hash] = value?.metadata
        for (const [hash, value] of Object.entries(data?.debridInstantAvailability ?? {})) {
            if (value) results.cached.add(hash.toLowerCase())
        }
        return data?.torrents ?? []
    }

    const searchProvider = async (provider: AutoSelectProvider) => {
        for (const resolution of resolutions) {
            const variables = (batch: boolean): SearchTorrent_Variables => ({
                type: provider.canSmartSearch ? "smart" : "simple",
                provider: provider.id,
                query: provider.canSmartSearch ? undefined : cleanMediaTitle(title),
                media,
                episodeNumber,
                batch,
                resolution: resolution || undefined,
            })
            const found: HibikeTorrent_AnimeTorrent[] = []
            const single = () => search(variables(false)).then(collect)
            try {
                if (searchBatch) {
                    const batch = await search(variables(true)).then(collect).catch(() => undefined)
                    if (batch && isUsableBatchResult(batch)) {
                        found.push(...batch, ...await single().catch(() => []))
                    } else {
                        found.push(...await single())
                    }
                } else {
                    found.push(...await single())
                }
            } catch {
                // This resolution failed; the server goes on to the next one.
                continue
            }
            if (found.length > 0) return found
        }
        return []
    }

    const perProvider = await Promise.all(params.providers.map(provider => searchProvider(provider).catch(() => [])))
    const seen = new Set<string>()
    for (const torrent of perProvider.flat()) {
        const key = torrent.infoHash ?? torrent.link
        if (seen.has(key)) continue
        seen.add(key)
        results.torrents.push(torrent)
    }
    return results
}

/** Below this many seeders a release is not "comparable" to a better seeded one. */
const COMPARABLE_SEEDERS = 5

function resolutionOf(entry: RankedTorrent<HibikeTorrent_AnimeTorrent>) {
    return (entry.parsed.video_resolution || entry.torrent.resolution || "").toLowerCase().replace(/p$/, "")
}

export type PlayableReleaseChoice<T> = {
    /** The release to start instead. */
    torrent: T
    /** The one auto-select would have taken. */
    avoided: T
    /** What the TV can't play in the avoided one ("FLAC"). */
    problem: string
}

/**
 * When the release auto-select would take has audio the TV can't play, the
 * best ranked one without it that is comparable: same resolution, seeded
 * enough to stream, and cached if the first one was (debrid). Null when the
 * first one is fine or nothing comparable exists; the server's own
 * auto-select then decides as usual.
 */
export function choosePlayableRelease<T extends HibikeTorrent_AnimeTorrent>(
    ranked: readonly RankedTorrent<T>[],
    cached?: ReadonlySet<string>,
): PlayableReleaseChoice<T> | null {
    const top = ranked[0]
    if (!top) return null
    const problem = releaseAudioProblem(top.torrent.name, top.parsed)
    if (!problem) return null

    const isCached = (torrent: T) => !!torrent.infoHash && !!cached?.has(torrent.infoHash.toLowerCase())
    const resolution = resolutionOf(top)
    const minSeeders = Math.min(top.torrent.seeders, COMPARABLE_SEEDERS)
    const alternative = ranked.find(entry => entry !== top
        && !releaseAudioProblem(entry.torrent.name, entry.parsed)
        && (!resolution || resolutionOf(entry) === resolution)
        && (entry.torrent.seeders < 0 || top.torrent.seeders < 0 || entry.torrent.seeders >= minSeeders)
        && (!isCached(top.torrent) || isCached(entry.torrent)))
    return alternative ? { torrent: alternative.torrent, avoided: top.torrent, problem } : null
}
