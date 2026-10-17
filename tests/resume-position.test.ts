import assert from "node:assert/strict"
import test from "node:test"
import type { Continuity_WatchHistory } from "../src/api/generated/types.ts"
import { getWatchHistoryResumePosition } from "../src/lib/player/resume-position.ts"

const history = (episodeNumber: number, currentTime: number, duration = 1440): Continuity_WatchHistory => ({
    154587: { kind: "mediastream", filepath: "/a.mkv", mediaId: 154587, episodeNumber, currentTime, duration },
})

test("resumes the same episode between 2 % and 90 %", () => {
    assert.equal(getWatchHistoryResumePosition(history(4, 600), { mediaId: 154587, episodeNumber: 4 }), 600)
})

test("starts over near the beginning or the end, or for another episode", () => {
    assert.equal(getWatchHistoryResumePosition(history(4, 10), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(history(4, 1400), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(history(3, 600), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(history(4, 600, 0), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(undefined, { mediaId: 154587, episodeNumber: 4 }), null)
})
