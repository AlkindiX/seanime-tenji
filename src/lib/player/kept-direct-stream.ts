import { getServerAuthHeaders } from "@/api/client/server-auth"
import type { NativePlayer_StreamType } from "@/api/generated/types"
import { logger } from "@/lib/utils/logger"
import React from "react"
import { Platform } from "react-native"
import type { DirectStreamSession } from "./direct-stream"
import { classifyKeptStreamProbe, createKeptStreamStore, type KeptStream, type KeptStreamEnd, type KeptStreamProbe } from "./kept-stream"
import type { MobilePlaybackSource } from "./types"

/**
 * webOS: the torrent or debrid stream the player left keeps running on the
 * server (see kept-stream.ts), with its direct-stream session, which goes on
 * collecting subtitle lines. Native builds play streams with mpv through an
 * external player link and never keep one.
 */

const log = logger("kept-stream")

/** How long a stream nobody watches keeps running on the server. */
export const KEPT_STREAM_IDLE_MS = 30 * 60_000
/** A HEAD request on the local network; don't hold the player back for long. */
const PROBE_TIMEOUT_MS = 3000

export type KeptDirectStream = KeptStream<MobilePlaybackSource, DirectStreamSession>

export const keptDirectStreams = createKeptStreamStore<MobilePlaybackSource, DirectStreamSession>(
    KEPT_STREAM_IDLE_MS,
    {
        now: () => Date.now(),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    },
    (kept, how, reason) => log.info("Kept stream ended", {
        reason,
        how,
        mediaId: kept.mediaId,
        episodeNumber: kept.episodeNumber,
        position: Math.round(kept.position),
    }),
)

/** Ends the kept stream (only `playbackId`, when given). `forget` when the server already ended it. */
export function endKeptStream(how: KeptStreamEnd = "terminate", playbackId?: string) {
    return keptDirectStreams.end(how, playbackId)
}

/** The server ended a stream on its own (stopped, failed): forget a kept one of that kind. */
export function forgetKeptStream(streamType?: NativePlayer_StreamType) {
    const kept = keptDirectStreams.current()
    if (!kept || (streamType && (kept.source.serverStreamType ?? "torrent") !== streamType)) return false
    return keptDirectStreams.end("forget", kept.playbackId)
}

/** The stream the player left for this episode, if it still runs. */
export function findKeptStream(mediaId: number, episodeNumber: number): KeptDirectStream | null {
    if (Platform.OS !== "web") return null
    return keptDirectStreams.find(mediaId, episodeNumber)
}

/** The stream the player left (for `mediaId`, when given), for showing it on screen. */
export function useKeptStream(mediaId?: number): KeptDirectStream | null {
    const kept = React.useSyncExternalStore(keptDirectStreams.subscribe, keptDirectStreams.current, keptDirectStreams.current)
    if (Platform.OS !== "web" || !kept || kept.leftAt === null) return null
    return mediaId === undefined || kept.mediaId === mediaId ? kept : null
}

/**
 * Asks the server whether it still serves the kept stream: it ends one on
 * its own when another client starts a stream, when it restarts, or when the
 * torrent is stopped from elsewhere. A HEAD request reads no video.
 */
export async function probeKeptStream(kept: KeptDirectStream): Promise<KeptStreamProbe> {
    const controller = typeof AbortController === "function" ? new AbortController() : null
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        controller?.abort()
    }, PROBE_TIMEOUT_MS)
    try {
        const response = await fetch(kept.source.url, {
            method: "HEAD",
            headers: getServerAuthHeaders(),
            cache: "no-store",
            signal: controller?.signal,
        })
        const probe = classifyKeptStreamProbe({ status: response.status })
        if (probe !== "alive") log.info("The server no longer serves the kept stream", { status: response.status })
        return probe
    } catch (error) {
        if (timedOut) return classifyKeptStreamProbe("no-answer")
        log.warning("Could not ask the server about the kept stream", error)
        // CORS can hide the answer of a server that is up; a no-cors request only fails when it is not.
        try {
            await fetch(kept.source.url, { method: "HEAD", mode: "no-cors", cache: "no-store", signal: controller?.signal })
            return classifyKeptStreamProbe("no-answer")
        } catch {
            return classifyKeptStreamProbe(timedOut ? "no-answer" : "unreachable")
        }
    } finally {
        clearTimeout(timer)
    }
}

// Closing the app ends the stream rather than leaving it to the server. The
// relay's socket is still open while the page unloads, so the message
// usually gets out; the idle timeout can't help once the app is gone.
if (Platform.OS === "web" && typeof window !== "undefined") {
    const endOnExit = () => {
        endKeptStream("terminate")
    }
    window.addEventListener("pagehide", endOnExit)
    window.addEventListener("beforeunload", endOnExit)
    // Home, another app or standby hide the app without unloading it, and a
    // suspended TV runs no idle timer. A stream nobody is watching ends while
    // the websocket is still up; one a player shows is left alone.
    document.addEventListener("visibilitychange", () => {
        const kept = keptDirectStreams.current()
        if (document.visibilityState === "hidden" && kept && kept.leftAt !== null) endKeptStream("terminate", kept.playbackId)
    })
}
