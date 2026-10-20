import assert from "node:assert/strict"
import test from "node:test"
import type { SearchTorrent_Variables } from "../src/api/generated/endpoint.types.ts"
import type { HibikeTorrent_AnimeTorrent, Torrent_SearchData } from "../src/api/generated/types.ts"
import {
    choosePlayableRelease,
    cleanMediaTitle,
    containsBoundedTerm,
    defaultAutoSelectProfile,
    parseSize,
    rankLikeAutoSelect,
    searchLikeAutoSelect,
    shouldSearchBatch,
} from "../src/components/features/torrentstream/auto-select-ranking.ts"
import { releaseAudioProblem } from "../src/components/features/torrentstream/release-audio.ts"
import { describeStreamCodecs, streamAudioWarning, streamFailureMessage, videoTrackProblem } from "../src/lib/player/direct-stream-format.ts"
import { decidePlayback } from "../src/lib/webos/playback-capabilities.ts"
import { audioTrackLabel, mkvAudioCodec, tvAudioSupport } from "../src/lib/webos/tv-audio.ts"
import { audioFallbackIndex, audioTrackTitle, languageKey, matchAudioTracks } from "../modules/expo-mpv-player/src/web/audio-tracks.ts"

///////////////////////////////////////////////////////////////////////////////
// Release names
///////////////////////////////////////////////////////////////////////////////

test("release names that mention FLAC are flagged", () => {
    for (const name of [
        "[Beatrice-Raws] Show 01 [BDRip 1920x1080 HEVC FLAC]",
        "[Group] Show - 01 (BD 1080p x265 10-bit FLACx2) [Dual-Audio]",
        "Show.S01E01.1080p.BluRay.FLAC2.0.x264-GRP",
        "[Group] Show (Opus/FLAC)",
    ]) {
        assert.equal(releaseAudioProblem(name), "FLAC", name)
    }
    for (const name of ["[SubsPlease] Show - 01 (1080p) [ABCD1234].mkv", "[Group] Flacon Story - 01 (AAC)", "Show S01E01 1080p WEB H.264 EAC3"]) {
        assert.equal(releaseAudioProblem(name), null, name)
    }
    // The parsed audio terms count too.
    assert.equal(releaseAudioProblem("[Group] Show - 01", { audio_term: ["FLAC", "Dual Audio"] }), "FLAC")
})

///////////////////////////////////////////////////////////////////////////////
// What the TV plays
///////////////////////////////////////////////////////////////////////////////

test("LG's player: stereo FLAC may play, more channels play silently, TrueHD is left out", () => {
    assert.equal(tvAudioSupport("aac", 6), "plays")
    assert.equal(tvAudioSupport("eac3", 6), "plays")
    assert.equal(tvAudioSupport("flac", 2), "risky")
    assert.equal(tvAudioSupport("flac"), "risky")
    assert.equal(tvAudioSupport("flac", 6), "broken")
    assert.equal(tvAudioSupport("truehd", 8), "broken")
    assert.equal(tvAudioSupport("dts", 6), "risky")
    assert.equal(tvAudioSupport("pcm_s24le", 2), "risky")
    assert.equal(mkvAudioCodec("A_FLAC"), "flac")
    assert.equal(mkvAudioCodec("A_AAC/MPEG4/LC"), "aac")
    assert.equal(audioTrackLabel("flac", 6), "FLAC 5.1")
    assert.equal(audioTrackLabel("eac3", 8), "E-AC-3 7.1")
    assert.equal(audioTrackLabel("opus"), "Opus")
})

test("library files whose default audio plays silently are transcoded", () => {
    const everything = { isTypeSupported: () => true }
    const video = { codec: "h264", mimeCodec: "avc1.640028", pixFmt: "yuv420p", width: 1920, height: 1080 }
    const surround = decidePlayback({ video, audios: [{ codec: "flac", channels: 6, isDefault: true }, { codec: "aac", channels: 2 }] }, everything)
    assert.equal(surround.mode, "transcode")
    assert.deepEqual(surround.reasons, ["FLAC 5.1 audio"])
    // Stereo FLAC is left to the TV, and so is a silent track that isn't the one it starts on.
    assert.equal(decidePlayback({ video, audios: [{ codec: "flac", channels: 2 }] }, everything).mode, "direct")
    assert.equal(decidePlayback({ video, audios: [{ codec: "aac", channels: 2, isDefault: true }, { codec: "flac", channels: 6 }] }, everything).mode, "direct")
    // webOS leaves TrueHD out and starts on the AC-3 track; TrueHD alone is silent.
    assert.equal(decidePlayback({ video, audios: [{ codec: "truehd", channels: 8, isDefault: true }, { codec: "ac3", channels: 6 }] }, everything).mode, "direct")
    assert.deepEqual(decidePlayback({ video, audios: [{ codec: "truehd", channels: 8 }] }, everything).reasons, ["TrueHD 7.1 audio"])
})

///////////////////////////////////////////////////////////////////////////////
// Streams: what to say when it fails
///////////////////////////////////////////////////////////////////////////////

const AVC = { number: 1, uid: 1, type: "video" as const, codecID: "V_MPEG4/ISO/AVC", default: true, forced: false, enabled: true, video: { PixelWidth: 1920, PixelHeight: 1080 } }
const audioTrack = (codecID: string, channels: number, extra: Record<string, unknown> = {}) => ({
    number: 2, uid: 2, type: "audio" as const, codecID, default: true, forced: false, enabled: true,
    audio: { SamplingFrequency: 48000, Channels: channels, BitDepth: 0 }, ...extra,
})

test("the video's decoder configuration tells 10-bit H.264 apart", () => {
    // configurationVersion 1, then profile_idc: 0x6E High 10, 0x64 High.
    assert.equal(videoTrackProblem({ codecID: "V_MPEG4/ISO/AVC", codecPrivate: "\u0001n\u0000\u001eÿ" }), "10-bit H.264 (Hi10P)")
    assert.equal(videoTrackProblem({ codecID: "V_MPEG4/ISO/AVC", codecPrivate: "\u0001d\u0000(ÿ" }), null)
    // A byte above 0x7f arrives replaced (U+FFFD): unknown, not a problem.
    assert.equal(videoTrackProblem({ codecID: "V_MPEG4/ISO/AVC", codecPrivate: "\u0001�\u0000" }), null)
    // HEVC general_profile_idc 4 (range extensions); Main10 (2) is fine.
    assert.equal(videoTrackProblem({ codecID: "V_MPEGH/ISO/HEVC", codecPrivate: "\u0001\u0004" }), "HEVC 4:2:2/4:4:4 or 12-bit")
    assert.equal(videoTrackProblem({ codecID: "V_MPEGH/ISO/HEVC", codecPrivate: "\u0001\u0002" }), null)
    assert.equal(videoTrackProblem({ codecID: "V_MPEG4/ISO/AVC" }), null)
})

test("a failed stream says what LG's player doesn't take and what to do", () => {
    const flac = describeStreamCodecs({ duration: 1, timecodeScale: 1, videoTracks: [AVC], audioTracks: [audioTrack("A_FLAC", 2)] })
    const message = streamFailureMessage(flac)
    assert.match(message, /^The TV could not play this stream \(H\.264, FLAC 2\.0\)\./)
    assert.match(message, /FLAC for music files only/)
    assert.match(message, /pick another release with AAC, AC-3 or E-AC-3 audio \(the release list marks FLAC ones\)/)
    assert.match(message, /download the episode to your library/)

    const hi10p = describeStreamCodecs({
        duration: 1, timecodeScale: 1,
        videoTracks: [{ ...AVC, codecPrivate: "\u0001n\u0000\u001e" }],
        audioTracks: [audioTrack("A_AAC", 2)],
    })
    assert.equal(hi10p.video, "10-bit H.264 (Hi10P)")
    assert.match(streamFailureMessage(hi10p), /LG TVs don't decode 10-bit H\.264 \(Hi10P\)\. .*with 8-bit H\.264 or HEVC video\./)
    assert.doesNotMatch(streamFailureMessage(hi10p), /FLAC/)
})

test("the start-of-stream warning tells silent surround FLAC from FLAC that may not start", () => {
    const stereo = describeStreamCodecs({ duration: 1, timecodeScale: 1, videoTracks: [AVC], audioTracks: [audioTrack("A_FLAC", 2)] })
    assert.match(streamAudioWarning(stereo) ?? "", /may not play FLAC 2\.0 audio\. If the video doesn't start/)
    const surround = describeStreamCodecs({ duration: 1, timecodeScale: 1, videoTracks: [AVC], audioTracks: [audioTrack("A_FLAC", 6)] })
    assert.match(streamAudioWarning(surround) ?? "", /more than two channels silently/)
    const fine = describeStreamCodecs({ duration: 1, timecodeScale: 1, videoTracks: [AVC], audioTracks: [audioTrack("A_EAC3", 6)] })
    assert.equal(streamAudioWarning(fine), null)
})

///////////////////////////////////////////////////////////////////////////////
// Audio tracks in the web player
///////////////////////////////////////////////////////////////////////////////

const japaneseFlac = { codec: "FLAC 5.1", language: "jpn", default: true, support: "broken" as const }
const japaneseAac = { codec: "AAC 2.0", language: "jpn", support: "plays" as const }
const englishAc3 = { codec: "AC-3 5.1", language: "eng", title: "English", support: "plays" as const }
const englishTrueHd = { codec: "TrueHD 7.1", language: "eng", support: "broken" as const, unlisted: true }

test("browser audio tracks are matched with the file's", () => {
    assert.equal(languageKey("jpn"), "ja")
    assert.equal(languageKey("ja-JP"), "ja")
    assert.equal(languageKey("und"), "")

    // Same count, nothing contradicting: file order.
    assert.deepEqual(matchAudioTracks([{ label: "", language: "ja" }, { label: "", language: "" }], [japaneseFlac, englishAc3]), [0, 1])
    // webOS left the TrueHD track out: set aside, the rest keep file order.
    assert.deepEqual(matchAudioTracks(
        [{ label: "", language: "jpn" }, { label: "English", language: "eng" }],
        [japaneseFlac, englishTrueHd, englishAc3],
    ), [0, 2])
    assert.deepEqual(matchAudioTracks([{ label: "", language: "en" }], [englishTrueHd, englishAc3]), [1])
    // Fewer browser tracks for another reason: by title, then language.
    assert.deepEqual(matchAudioTracks(
        [{ label: "English", language: "" }],
        [japaneseFlac, englishAc3],
    ), [1])
    // Default track listed first (webOS 24): the languages contradict file order.
    assert.deepEqual(matchAudioTracks([{ label: "", language: "en" }, { label: "", language: "ja" }], [japaneseFlac, englishAc3]), [1, 0])
    // Nothing to go by.
    assert.deepEqual(matchAudioTracks([{ label: "", language: "" }], [japaneseFlac, englishAc3]), [null])
    // No languages and a default track that isn't first: the order can't be trusted.
    const secondDefault = [{ ...englishAc3, default: false }, japaneseFlac]
    assert.deepEqual(matchAudioTracks([{ label: "", language: "" }, { label: "", language: "" }], secondDefault), [null, null])
})

test("a silent track is left for one the TV plays, in the same language first", () => {
    assert.equal(audioFallbackIndex(0, [0, 1], [japaneseFlac, englishAc3]), 1)
    assert.equal(audioFallbackIndex(0, [0, 1, 2], [japaneseFlac, englishAc3, japaneseAac]), 2)
    // Nothing better: stay.
    assert.equal(audioFallbackIndex(0, [0, 1], [japaneseFlac, englishTrueHd]), null)
    // The track it plays is already on.
    assert.equal(audioFallbackIndex(1, [0, 1], [japaneseFlac, englishAc3]), null)
    // No track says it is on, or the one on is unknown: nothing tells what plays, so leave it.
    assert.equal(audioFallbackIndex(-1, [0, 1], [japaneseFlac, englishAc3]), null)
    assert.equal(audioFallbackIndex(0, [null, 1], [japaneseFlac, englishAc3]), null)

    assert.equal(audioTrackTitle("Japanese", japaneseFlac), "Japanese · FLAC 5.1, may be silent on this TV")
    assert.equal(audioTrackTitle("", englishAc3), "English · AC-3 5.1")
    assert.equal(audioTrackTitle("Commentary", undefined), "Commentary")
})

///////////////////////////////////////////////////////////////////////////////
// Auto-select like the server, avoiding FLAC
///////////////////////////////////////////////////////////////////////////////

function release(name: string, seeders: number, extra: Partial<HibikeTorrent_AnimeTorrent> = {}): HibikeTorrent_AnimeTorrent {
    return {
        name, seeders, infoHash: name, provider: "nyaa", date: "", size: 0, formattedSize: "", leechers: 0, downloadCount: 0,
        link: name, downloadUrl: "", isBestRelease: false, confirmed: false, ...extra,
    }
}

const metadataOf = (torrents: HibikeTorrent_AnimeTorrent[]) => Object.fromEntries(torrents.map((torrent) => {
    const resolution = /(\d{3,4}p)/.exec(torrent.name)?.[1]
    const group = /^\[([^\]]+)\]/.exec(torrent.name)?.[1]
    return [torrent.infoHash!, { video_resolution: resolution, release_group: group }]
}))

test("candidates are ranked as the server's auto-select ranks them", () => {
    const torrents = [
        release("[A] Show - 01 (720p)", 500),
        release("[B] Show - 01 (1080p)", 20),
        release("[C] Show - 01 (1080p)", 90),
        release("[D] Show - 01 (1080p) [CamRip]", 900),
    ]
    const metadata = metadataOf(torrents)
    const byDefault = rankLikeAutoSelect(torrents, metadata, defaultAutoSelectProfile("1080p"))
    // The resolution first, then seeders.
    assert.deepEqual(byDefault.map(entry => entry.torrent.name.slice(0, 3)), ["[D]", "[C]", "[B]", "[A]"])

    const profile = { resolutions: ["1080p", "720p"], releaseGroups: ["B"], excludeTerms: ["camrip"], minSeeders: 10 }
    assert.deepEqual(rankLikeAutoSelect(torrents, metadata, profile).map(entry => entry.torrent.name.slice(0, 3)), ["[B]", "[C]", "[A]"])

    assert.equal(containsBoundedTerm("show bd 1080p", "bd"), true)
    assert.equal(containsBoundedTerm("show bdrip 1080p", "bd"), false)
    assert.equal(parseSize("1.5 GiB"), 1.5 * 1024 ** 3)
    assert.equal(parseSize("nope"), null)
    assert.equal(cleanMediaTitle("Re:Zero - Starting Life (2016)"), "ReZero Starting Life 2016")
})

test("a FLAC pick gives way to a comparable release without FLAC", () => {
    const flac = release("[Big] Show - 01 (1080p BD FLAC)", 200)
    const aac = release("[Web] Show - 01 (1080p AAC)", 40)
    const lowRes = release("[Low] Show - 01 (720p AAC)", 500)
    const deadAac = release("[Dead] Show - 01 (1080p AAC)", 1)
    const all = [flac, aac, lowRes, deadAac]
    const rank = (torrents: HibikeTorrent_AnimeTorrent[], cached?: Set<string>) =>
        rankLikeAutoSelect(torrents, metadataOf(torrents), defaultAutoSelectProfile("1080p"), cached)

    const choice = choosePlayableRelease(rank(all))
    assert.equal(choice?.torrent, aac)
    assert.equal(choice?.avoided, flac)
    assert.equal(choice?.problem, "FLAC")

    // Not comparable: another resolution, or too few seeders to stream.
    assert.equal(choosePlayableRelease(rank([flac, lowRes, deadAac])), null)
    // Auto-select would not take the FLAC one anyway.
    const popular = release("[Pop] Show - 01 (1080p AAC)", 300)
    assert.equal(choosePlayableRelease(rank([popular, flac])), null)

    // Debrid: a cached FLAC release only gives way to a cached one.
    const cached = new Set([flac.infoHash!.toLowerCase()])
    assert.equal(choosePlayableRelease(rank(all, cached), cached), null)
    cached.add(aac.infoHash!.toLowerCase())
    assert.equal(choosePlayableRelease(rank(all, cached), cached)?.torrent, aac)
})

test("searches run like the server's: batches first for a finished series, then single episodes", async () => {
    const now = new Date(Date.UTC(2026, 9, 21))
    const finished = { status: "FINISHED" as const, format: "TV" as const, endDate: { year: 2020, month: 3, day: 1 } }
    assert.equal(shouldSearchBatch(finished, now), true)
    assert.equal(shouldSearchBatch({ ...finished, endDate: { year: 2026, month: 10, day: 15 } }, now), false)
    assert.equal(shouldSearchBatch({ ...finished, format: "MOVIE" }, now), false)
    assert.equal(shouldSearchBatch({ ...finished, status: "RELEASING" }, now), false)

    const calls: SearchTorrent_Variables[] = []
    const search = async (variables: SearchTorrent_Variables): Promise<Torrent_SearchData> => {
        calls.push(variables)
        if (variables.resolution === "1080p") return { torrents: [] }
        const torrents = variables.batch
            ? [release("[Batch] Show (BD 720p FLAC)", 50)]
            : [release("[Web] Show - 03 (720p)", 30), release("[Batch] Show (BD 720p FLAC)", 50)]
        return {
            torrents,
            torrentMetadata: Object.fromEntries(torrents.map(torrent => [torrent.infoHash!, { distance: 0, metadata: { video_resolution: "720p" } }])),
            debridInstantAvailability: { "[Web] Show - 03 (720p)": { cachedFiles: {} } },
        }
    }
    const media = { id: 1, title: { romaji: "Show: Two" }, ...finished } as Parameters<typeof searchLikeAutoSelect>[0]["media"]
    const results = await searchLikeAutoSelect({
        search,
        providers: [{ id: "nyaa", canSmartSearch: true }, { id: "simple", canSmartSearch: false }],
        media,
        episodeNumber: 3,
        profile: { resolutions: ["1080p", "720p"] },
        now,
    })

    const nyaa = calls.filter(call => call.provider === "nyaa")
    assert.deepEqual(nyaa.map(call => [call.resolution, call.batch]), [["1080p", true], ["1080p", false], ["720p", true], ["720p", false]])
    const simple = calls.find(call => call.provider === "simple")
    assert.equal(simple?.type, "simple")
    assert.equal(simple?.query, "Show Two")
    // Deduplicated across searches and providers, with what came with them.
    assert.deepEqual(results.torrents.map(torrent => torrent.name), ["[Batch] Show (BD 720p FLAC)", "[Web] Show - 03 (720p)"])
    assert.equal(results.metadata["[Web] Show - 03 (720p)"]?.video_resolution, "720p")
    assert.equal(results.cached.has("[web] show - 03 (720p)"), true)
})
