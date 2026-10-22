import assert from "node:assert/strict"
import test from "node:test"
import type { Torrentstream_TorrentStatus } from "../src/api/generated/types.ts"
import { describeTorrentStatus } from "../src/lib/player/stream-telemetry.ts"

const status = (patch: Partial<Torrentstream_TorrentStatus> = {}): Torrentstream_TorrentStatus => ({
    uploadProgress: 0,
    downloadProgress: 0,
    progressPercentage: 42.17,
    downloadSpeed: "3.2 MB/s",
    uploadSpeed: "120 kB/s",
    size: "1.4 GB",
    seeders: 12,
    ...patch,
})

test("speed, share downloaded, seeders and buffer ahead", () => {
    const stats = describeTorrentStatus(status(), 45.8)
    assert.equal(stats.speed, "3.2 MB/s")
    assert.equal(stats.downloaded, "42.1%")
    assert.equal(stats.seeders, "12 seeders")
    assert.equal(stats.buffered, "45s")
    assert.equal(stats.label, "Downloading at 3.2 MB/s, 42.1% downloaded, 12 seeders, 45s buffered")
})

test("nothing buffered leaves the buffer out", () => {
    const stats = describeTorrentStatus(status({ seeders: 1, downloadSpeed: "" }), 0)
    assert.equal(stats.buffered, null)
    assert.equal(stats.speed, "0 B/s")
    assert.equal(stats.label, "Downloading at 0 B/s, 42.1% downloaded, 1 seeder")
})

test("100% only once every piece is in; long buffers read as minutes", () => {
    assert.equal(describeTorrentStatus(status({ progressPercentage: 99.97 }), 0).downloaded, "99.9%")
    assert.equal(describeTorrentStatus(status({ progressPercentage: 100 }), 0).downloaded, "100%")
    assert.equal(describeTorrentStatus(status(), 125).buffered, "2:05")
})
