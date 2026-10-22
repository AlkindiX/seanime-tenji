import assert from "node:assert/strict"
import test from "node:test"
import {
    HOME_HERO_MAX_SLIDES,
    homeTrendingSkipIds,
    pickHomeTrending,
    pickTrendingHeroItems,
    trendingShelfIndex,
} from "../src/components/tv/tv-home-feed.ts"

type Media = { id: number; bannerImage?: string | null }

const media = (id: number, banner = true): Media => ({ id, bannerImage: banner ? `banner-${id}.jpg` : null })

test("trending keeps AniList's order and rank, without shows to continue", () => {
    const items = pickHomeTrending([media(5), media(7), media(9), media(11)], [7, 42])
    assert.deepEqual(items.map(item => [item.media.id, item.rank]), [[5, 1], [9, 3], [11, 4]])
})

test("trending leaves out the Currently watching list too", () => {
    const lists = [
        { type: "CURRENT", entries: [{ mediaId: 9, media: { id: 9 } }, { mediaId: 13 }, null] },
        { type: "PLANNING", entries: [{ mediaId: 5, media: { id: 5 } }] },
        null,
    ]
    const skip = homeTrendingSkipIds([7], lists)
    assert.deepEqual([...skip].sort((a, b) => a - b), [7, 9, 13])

    const items = pickHomeTrending([media(5), media(7), media(9), media(11), media(13)], skip)
    // Planning isn't on screen near the row, so its shows stay; ranks keep AniList's order.
    assert.deepEqual(items.map(item => [item.media.id, item.rank]), [[5, 1], [11, 4]])
})

test("without a Currently watching list only the shows to continue are left out", () => {
    assert.deepEqual([...homeTrendingSkipIds([3, 4], [{ type: "COMPLETED", entries: [{ mediaId: 1 }] }])], [3, 4])
    assert.deepEqual([...homeTrendingSkipIds([], [])], [])
})

test("trending skips empty entries and repeats", () => {
    const items = pickHomeTrending([media(1), null, undefined, media(1), media(2)], [])
    assert.deepEqual(items.map(item => [item.media.id, item.rank]), [[1, 1], [2, 5]])
})

test("no trending data gives nothing", () => {
    assert.deepEqual(pickHomeTrending(undefined, [1]), [])
    assert.deepEqual(pickHomeTrending(null, []), [])
    assert.deepEqual(pickHomeTrending([], []), [])
})

test("trending fills the hero after the shows to continue", () => {
    const trending = pickHomeTrending([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id => media(id)), [])
    assert.equal(pickTrendingHeroItems(trending, 0).length, HOME_HERO_MAX_SLIDES)
    assert.deepEqual(pickTrendingHeroItems(trending, 5).map(item => item.media.id), [1, 2, 3])
    assert.deepEqual(pickTrendingHeroItems(trending, HOME_HERO_MAX_SLIDES), [])
    // Continue watching keeps up to 12 slides of its own.
    assert.deepEqual(pickTrendingHeroItems(trending, 12), [])
})

test("only trending shows with a banner become hero slides", () => {
    const trending = pickHomeTrending([media(1, false), media(2), media(3, false), media(4)], [])
    assert.deepEqual(pickTrendingHeroItems(trending, 0).map(item => [item.media.id, item.rank]), [[2, 2], [4, 4]])
})

test("the trending row follows Currently watching, or comes first", () => {
    assert.equal(trendingShelfIndex(["CURRENT", "PAUSED", "PLANNING"]), 1)
    assert.equal(trendingShelfIndex(["PAUSED", "CURRENT"]), 2)
    assert.equal(trendingShelfIndex(["PLANNING", "server-local"]), 0)
    assert.equal(trendingShelfIndex([]), 0)
})
