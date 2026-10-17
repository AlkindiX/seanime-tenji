import { getClientIdentity } from "@/api/client/client-identity"
import { buildSeaQuery } from "@/api/client/requests"
import { appendServerHMACToken } from "@/api/client/server-auth"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Mediastream_MediaContainer } from "@/api/generated/types"
import { logger } from "@/lib/utils/logger"
import type { MpvExternalSubtitle } from "expo-mpv-player"
import React from "react"
import type { MobilePlaybackSource } from "./types"

const log = logger("extracted-subtitles")

const NONE: MpvExternalSubtitle[] = []
const SUBS_ENDPOINT = "/api/v1/mediastream/subs"
// Extraction runs ffprobe/ffmpeg on the server; don't hold playback back for long.
const TIMEOUT_MS = 8000

async function fetchExtractedSubtitles(source: MobilePlaybackSource): Promise<MpvExternalSubtitle[]> {
    const path = source.localFile?.path
    const apiIndex = source.url.indexOf("/api/v1/")
    if (!path || source.streamKind !== "http" || apiIndex < 0) return NONE

    const serverUrl = source.url.slice(0, apiIndex)
    const container = await buildSeaQuery<Mediastream_MediaContainer>({
        serverUrl,
        endpoint: API_ENDPOINTS.MEDIASTREAM.RequestMediastreamMediaContainer.endpoint,
        method: "POST",
        data: { path, streamType: "direct", clientId: getClientIdentity().clientId },
        muteError: true,
        timeoutMs: TIMEOUT_MS,
    })

    return (container?.mediaInfo?.subtitles ?? []).flatMap((subtitle) => {
        if (!subtitle.link) return []
        const endpoint = `${SUBS_ENDPOINT}${subtitle.link}`
        return [{
            url: appendServerHMACToken(`${serverUrl}${endpoint}`, endpoint),
            title: subtitle.title,
            lang: subtitle.language,
        }]
    })
}

/**
 * Browsers (and so the webOS player) can't read subtitle tracks embedded in
 * MKV files. For library files the server's media streaming module extracts
 * them; this resolves to those tracks, `[]` when the server can't provide
 * them, and `undefined` while still asking.
 */
export function useExtractedSubtitles(source: MobilePlaybackSource | null): MpvExternalSubtitle[] | undefined {
    const [resolved, setResolved] = React.useState<{ id: string; subtitles: MpvExternalSubtitle[] } | null>(null)
    const needsLookup = !!source?.localFile?.path && source.streamKind === "http"

    React.useEffect(() => {
        if (!source || !needsLookup) return
        let cancelled = false

        fetchExtractedSubtitles(source)
            .catch((error) => {
                log.warning("Could not get subtitle tracks from the server", error)
                return NONE
            })
            .then((subtitles) => {
                if (!cancelled) setResolved({ id: source.id, subtitles })
            })

        return () => {
            cancelled = true
        }
    }, [needsLookup, source])

    if (!source || !needsLookup) return NONE
    return resolved?.id === source.id ? resolved.subtitles : undefined
}
