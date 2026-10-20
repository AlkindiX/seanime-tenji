import type { Torrentstream_TorrentStatus } from "@/api/generated/types"

/** The torrent stream's stats as the player's controls show them. */
export type StreamTelemetry = {
    speed: string
    downloaded: string
    seeders: string
    /** How far ahead of playback the video is buffered; null when it isn't. */
    buffered: string | null
    /** The whole line, for the TV's audio guidance. */
    label: string
}

function bufferedLabel(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 1) return null
    const total = Math.floor(seconds)
    if (total < 60) return `${total}s`
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export function describeTorrentStatus(status: Torrentstream_TorrentStatus, bufferedSeconds: number): StreamTelemetry {
    const speed = status.downloadSpeed?.trim() || "0 B/s"
    const percent = Number.isFinite(status.progressPercentage) ? Math.max(0, status.progressPercentage) : 0
    // 99.96 would round up to "100.0%" while pieces are still missing.
    const downloaded = percent >= 100 ? "100%" : `${Math.min(99.9, Math.floor(percent * 10) / 10).toFixed(1)}%`
    const count = Number.isFinite(status.seeders) ? Math.max(0, Math.round(status.seeders)) : 0
    const seeders = `${count} ${count === 1 ? "seeder" : "seeders"}`
    const ahead = bufferedLabel(bufferedSeconds)

    const label = [
        `Downloading at ${speed}`,
        `${downloaded} downloaded`,
        seeders,
        ahead ? `${ahead} buffered` : null,
    ].filter(Boolean).join(", ")

    return { speed, downloaded, seeders, buffered: ahead, label }
}
