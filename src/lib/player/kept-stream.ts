/**
 * The stream the player left (webOS). Back from the player keeps a torrent or
 * debrid direct stream running on the server, so playing the same episode
 * again picks it up where it was instead of asking the server for a new
 * stream, which would drop the torrent and download it again.
 *
 * One stream at most: the server plays one direct stream at a time. It ends
 * when another stream starts, when the user stops it, or after nobody
 * watched it for `idleMs`. Kept free of React Native so the tests can load
 * it; the clock and timers are passed in.
 */

export type KeptSession = {
    /** Tells the server the player is gone, which ends the stream. */
    terminate: () => void
    /** Stops listening without telling the server, which already ended the stream. */
    forget: () => void
}

export type KeptStream<Source, Session extends KeptSession = KeptSession> = {
    playbackId: string
    mediaId: number
    episodeNumber: number
    source: Source
    session: Session
    /** Seconds into the episode where the player left it. */
    position: number
    /** When the player left it; null while a player shows it. */
    leftAt: number | null
}

/** `terminate`: tell the server. `forget`: the server already ended it. */
export type KeptStreamEnd = "terminate" | "forget"

/** Why a kept stream ended, for the logs. */
export type KeptStreamEndReason = "ended" | "idle" | "replaced"

export type KeptStreamClock = {
    now: () => number
    setTimeout: (callback: () => void, ms: number) => unknown
    clearTimeout: (timer: unknown) => void
}

export function createKeptStreamStore<Source, Session extends KeptSession>(
    idleMs: number,
    clock: KeptStreamClock,
    onEnd?: (kept: KeptStream<Source, Session>, how: KeptStreamEnd, reason: KeptStreamEndReason) => void,
) {
    let kept: KeptStream<Source, Session> | null = null
    let idleTimer: unknown = null
    const listeners = new Set<() => void>()

    const notify = () => {
        for (const listener of listeners) listener()
    }

    const stopIdleTimer = () => {
        if (idleTimer !== null) clock.clearTimeout(idleTimer)
        idleTimer = null
    }

    const finish = (how: KeptStreamEnd, reason: KeptStreamEndReason) => {
        const ended = kept
        if (!ended) return
        // Cleared first: a session that calls back into the store finds nothing kept.
        kept = null
        stopIdleTimer()
        if (how === "terminate") ended.session.terminate()
        else ended.session.forget()
        onEnd?.(ended, how, reason)
        notify()
    }

    /** A stream the player left longer ago than `idleMs` (a suspended TV runs no timers). */
    const expired = (entry: KeptStream<Source, Session>) => entry.leftAt !== null && clock.now() - entry.leftAt >= idleMs

    return {
        /** The kept stream, also while a player shows it. */
        current: () => kept,

        /**
         * A player shows this stream. The kept one is picked up again; another
         * one replaces it. The server already ended that one when it opened
         * the new stream, so it is forgotten: a late "video-terminated" would
         * clear the new stream's player state on the server.
         */
        attach(entry: Omit<KeptStream<Source, Session>, "position" | "leftAt">) {
            stopIdleTimer()
            if (kept && kept.playbackId !== entry.playbackId) finish("forget", "replaced")
            kept = { ...entry, position: kept?.position ?? 0, leftAt: null }
            notify()
        },

        /**
         * The player closed: the stream keeps running from `position`. False
         * when it isn't the kept stream any more (it ended meanwhile).
         */
        leave(playbackId: string, position: number): boolean {
            if (!kept || kept.playbackId !== playbackId) return false
            kept = { ...kept, position: Number.isFinite(position) && position > 0 ? position : 0, leftAt: clock.now() }
            stopIdleTimer()
            idleTimer = clock.setTimeout(() => {
                idleTimer = null
                if (kept?.playbackId === playbackId) finish("terminate", "idle")
            }, idleMs)
            notify()
            return true
        },

        /** The stream the player left for this episode, if it is still kept. */
        find(mediaId: number, episodeNumber: number): KeptStream<Source, Session> | null {
            if (!kept || kept.leftAt === null) return null
            if (expired(kept)) {
                finish("terminate", "idle")
                return null
            }
            return kept.mediaId === mediaId && kept.episodeNumber === episodeNumber ? kept : null
        },

        /** Ends the kept stream (only if it is `playbackId`, when given). False when nothing was kept. */
        end(how: KeptStreamEnd, playbackId?: string): boolean {
            if (!kept || (playbackId !== undefined && kept.playbackId !== playbackId)) return false
            finish(how, "ended")
            return true
        },

        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}

/** What asking the server for the kept stream's URL said. */
export type KeptStreamProbe = "alive" | "gone" | "unknown"

/**
 * The server answers a stream it no longer serves with 404 (another stream
 * replaced it) or 500 ("no stream"); an expired link is 401/403. A server
 * that can't be reached would fail a fresh start too, which at least says
 * why. No answer in time, or one CORS hid: try the kept stream anyway.
 */
export function classifyKeptStreamProbe(result: { status: number } | "unreachable" | "no-answer"): KeptStreamProbe {
    if (result === "no-answer") return "unknown"
    if (result === "unreachable") return "gone"
    return result.status >= 200 && result.status < 400 ? "alive" : "gone"
}
