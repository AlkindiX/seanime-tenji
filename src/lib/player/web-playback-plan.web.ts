import { getClientIdentity } from "@/api/client/client-identity"
import { buildSeaQuery } from "@/api/client/requests"
import { appendServerHMACToken, getServerAuthHeaders } from "@/api/client/server-auth"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import type { MediaInfo, Mediastream_MediaContainer, Models_MediastreamSettings } from "@/api/generated/types"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { describeDevice, getDeviceInfo } from "@/lib/webos/device-info"
import {
    browserCodecProbe,
    decidePlayback,
    describeAudio,
    describeVideo,
    pixelBitDepth,
    videoCodecName,
} from "@/lib/webos/playback-capabilities"
import type { MpvChapter, MpvExternalSubtitle } from "expo-mpv-player"
import React from "react"
import { getWatchHistoryResumePosition } from "./resume-position"
import type { MobilePlaybackSource, WebPlaybackPlan } from "./types"

const log = logger("web-playback-plan")

const SUBS_ENDPOINT = "/api/v1/mediastream/subs"
// The request runs ffprobe/ffmpeg on the server; don't hold playback back for long.
const TIMEOUT_MS = 8000
/** MediaError codes for "can't decode" and "format not supported". */
const DECODE_ERRORS = new Set([3, 4])
const NO_SUBTITLES: MpvExternalSubtitle[] = []

/** What the plan was built from, kept for explaining a later error. */
type Resolved = {
    key: string
    plan: Omit<WebPlaybackPlan, "onPlaybackError">
    library: boolean
    transcodeAvailable: boolean
    audioWarnings: string[]
    mediaInfo?: MediaInfo
}

function serverUrlOf(source: MobilePlaybackSource) {
    const apiIndex = source.url.indexOf("/api/v1/")
    return apiIndex < 0 ? null : source.url.slice(0, apiIndex)
}

function isLibraryFile(source: MobilePlaybackSource | null): source is MobilePlaybackSource {
    return !!source?.localFile?.path && source.streamKind === "http" && serverUrlOf(source) !== null
}

function toChapters(mediaInfo: MediaInfo | undefined): MpvChapter[] {
    return (mediaInfo?.chapters ?? [])
        .filter(chapter => Number.isFinite(chapter.startTime))
        .map((chapter, index) => ({ id: index, time: chapter.startTime, title: chapter.name || undefined }))
}

function toSubtitles(serverUrl: string, mediaInfo: MediaInfo | undefined): MpvExternalSubtitle[] {
    return (mediaInfo?.subtitles ?? []).flatMap((subtitle) => {
        if (!subtitle.link) return []
        const endpoint = `${SUBS_ENDPOINT}${subtitle.link}`
        return [{
            url: appendServerHMACToken(`${serverUrl}${endpoint}`, endpoint),
            title: subtitle.title,
            lang: subtitle.language,
        }]
    })
}

function requestStream(serverUrl: string, path: string, streamType: "direct" | "transcode") {
    return buildSeaQuery<Mediastream_MediaContainer>({
        serverUrl,
        endpoint: API_ENDPOINTS.MEDIASTREAM.RequestMediastreamMediaContainer.endpoint,
        method: "POST",
        data: { path, streamType, clientId: getClientIdentity().clientId },
        muteError: true,
        timeoutMs: TIMEOUT_MS,
    })
}

function shutdownTranscode(serverUrl: string) {
    void buildSeaQuery<boolean>({
        serverUrl,
        endpoint: API_ENDPOINTS.MEDIASTREAM.MediastreamShutdownTranscodeStream.endpoint,
        method: "POST",
        muteError: true,
    }).catch(error => log.warning("Could not stop the server's transcode", error))
}

/**
 * Asks the server about a library file: its tracks, chapters and codecs.
 * When the TV can't decode it (or did not, `forceTranscode`) and the server
 * transcodes, the plan plays the server's HLS transcode instead.
 */
async function resolveLibraryPlan(source: MobilePlaybackSource, forceTranscode: boolean, startPosition?: number): Promise<Omit<Resolved, "key">> {
    const serverUrl = serverUrlOf(source)!
    const path = source.localFile!.path

    const [container, settings, device] = await Promise.all([
        requestStream(serverUrl, path, "direct").catch((error) => {
            log.warning("Could not get the file's media info from the server", error)
            return undefined
        }),
        buildSeaQuery<Models_MediastreamSettings>({
            serverUrl,
            endpoint: API_ENDPOINTS.MEDIASTREAM.GetMediastreamSettings.endpoint,
            method: "GET",
            muteError: true,
            timeoutMs: TIMEOUT_MS,
        }).catch(() => undefined),
        getDeviceInfo(),
    ])

    const mediaInfo = container?.mediaInfo
    const decision = decidePlayback(mediaInfo, browserCodecProbe(), device)
    const transcodeAvailable = !!settings?.transcodeEnabled && !settings.directPlayOnly
    const reasons = decision.reasons
    const video = mediaInfo?.video

    const plan: Omit<WebPlaybackPlan, "onPlaybackError"> = {
        externalSubtitles: toSubtitles(serverUrl, mediaInfo),
        chapters: toChapters(mediaInfo),
        startPosition,
        mediaInfoSummary: {
            mode: "direct",
            reasons,
            videoCodec: describeVideo(video),
            audioCodec: describeAudio(mediaInfo?.audios),
            resolution: video?.width && video.height ? `${video.width}×${video.height}` : undefined,
            device: describeDevice(device) ?? undefined,
        },
    }

    if ((decision.mode === "transcode" || forceTranscode) && transcodeAvailable) {
        const transcode = await requestStream(serverUrl, path, "transcode").catch((error) => {
            log.warning("The server could not start transcoding", error)
            return undefined
        })
        if (transcode?.streamUrl) {
            plan.url = `${serverUrl}${transcode.streamUrl}`
            plan.headers = getServerAuthHeaders()
            plan.preferMse = true
            const summary = plan.mediaInfoSummary!
            summary.mode = "transcode"
            // The server's transcode is always H.264.
            summary.videoCodec = `${summary.videoCodec ?? "source"} → H.264`
            if (forceTranscode && reasons.length === 0) summary.reasons = ["the TV could not decode the original file"]
        }
    }

    log.info("Playback plan", {
        sourceId: source.id,
        mode: plan.mediaInfoSummary!.mode,
        reasons,
        audioWarnings: decision.audioWarnings,
        transcodeAvailable,
        video: describeVideo(video),
    })

    return { plan, library: true, transcodeAvailable, audioWarnings: decision.audioWarnings, mediaInfo }
}

function describeFileCodec(mediaInfo: MediaInfo | undefined) {
    const video = mediaInfo?.video
    if (!video?.codec) return undefined
    const depth = pixelBitDepth(video.pixFmt)
    return `${depth > 8 ? `${depth}-bit ` : ""}${videoCodecName(video.codec)}`
}

/** The text for a decode error that the plan can't work around. */
function decodeErrorMessage(source: MobilePlaybackSource, resolved: Resolved | null) {
    const base = "The TV could not decode this video"
    if (!resolved?.library) {
        return `${base}. Only files in your library can be transcoded by the server; this stream plays as it is.`
    }
    const summary = resolved.plan.mediaInfoSummary
    if (summary?.mode === "transcode") return `${base}, even after the server transcoded it to H.264.`
    const what = summary?.reasons?.length ? summary.reasons.join(", ") : describeFileCodec(resolved.mediaInfo)
    const detail = what ? ` (${what})` : ""
    if (!resolved.transcodeAvailable) {
        return `${base}${detail}. Turn on transcoding in the Seanime server's media streaming settings to play it on this TV.`
    }
    log.warning("Decode error after the transcode fallback", source.id)
    return `${base}${detail}.`
}

function announce(plan: Omit<WebPlaybackPlan, "onPlaybackError">, audioWarnings: string[], fallback: boolean) {
    const summary = plan.mediaInfoSummary
    const reasons = summary?.reasons ?? []
    const audio = audioWarnings.length > 0 ? ` ${audioWarnings.join(". ")}.` : ""
    if (summary?.mode === "transcode") {
        const why = fallback ? "the TV could not decode the original file" : `this TV can't play ${reasons.join(", ")}`
        // The transcode carries AAC audio, so audio warnings no longer apply.
        toast.info(`Transcoding: ${why}.`, { visibilityTime: 4000 })
    } else if (reasons.length > 0) {
        toast.warning(`This TV may not play ${reasons.join(", ")}. Turn on transcoding on the server if it fails.${audio}`, { visibilityTime: 5000 })
    } else if (audio) {
        toast.warning(audio.trim(), { visibilityTime: 4000 })
    }
}

/**
 * The webOS player plays what the TV decodes, so library files are checked
 * first: the server lists their subtitle tracks (which browsers can't read
 * from MKV), chapters and codecs, and transcodes what the TV can't play.
 * Resolves `undefined` while asking. Other streams play as they are.
 */
export function useWebPlaybackPlan(source: MobilePlaybackSource | null): WebPlaybackPlan | undefined {
    const [resolved, setResolved] = React.useState<Resolved | null>(null)
    // Set when a direct-play file failed to decode: play it transcoded from there.
    const [fallback, setFallback] = React.useState<{ id: string; position?: number } | null>(null)
    const { data: watchHistory } = useGetContinuityWatchHistory()
    const library = isLibraryFile(source)
    const forceTranscode = !!source && fallback?.id === source.id
    const key = source ? `${source.id}:${forceTranscode ? "transcode" : "auto"}` : ""
    // The effect runs per source id: the source object can be replaced during
    // playback, and planning again would restart the server's transcode.
    const latest = React.useRef({ source, fallback, watchHistory })
    latest.current = { source, fallback, watchHistory }

    React.useEffect(() => {
        const { source, fallback, watchHistory } = latest.current
        if (!source || !library) return
        let cancelled = false
        let transcoding = false
        const serverUrl = serverUrlOf(source)!
        // Library files resume from the watch history. Passing the position
        // with the source lets the player start there (mediaOption on webOS)
        // instead of seeking once playback has begun.
        const startPosition = forceTranscode
            ? fallback?.position
            : (source.resumePositionSec ?? getWatchHistoryResumePosition(watchHistory, source) ?? undefined)

        resolveLibraryPlan(source, forceTranscode, startPosition)
            .catch((error): Omit<Resolved, "key"> => {
                log.warning("Could not plan playback; playing the file directly", error)
                return { plan: { externalSubtitles: NO_SUBTITLES }, library: true, transcodeAvailable: false, audioWarnings: [] }
            })
            .then((result) => {
                transcoding = result.plan.mediaInfoSummary?.mode === "transcode"
                if (cancelled) {
                    if (transcoding) shutdownTranscode(serverUrl)
                    return
                }
                setResolved({ ...result, key })
                announce(result.plan, result.audioWarnings, forceTranscode)
            })

        return () => {
            cancelled = true
            if (transcoding) shutdownTranscode(serverUrl)
        }
    }, [forceTranscode, key, library])

    const current = library ? (resolved?.key === key ? resolved : null) : null

    const onPlaybackError = React.useCallback<NonNullable<WebPlaybackPlan["onPlaybackError"]>>((error) => {
        if (!source || !DECODE_ERRORS.has(error.code ?? 0)) return null
        if (current && current.library && current.transcodeAvailable
            && current.plan.mediaInfoSummary?.mode !== "transcode" && fallback?.id !== source.id) {
            log.info("Direct play failed to decode; switching to the server's transcode", { sourceId: source.id, position: error.position })
            setFallback({ id: source.id, position: error.position > 0 ? error.position : current.plan.startPosition })
            return true
        }
        return decodeErrorMessage(source, current)
    }, [current, fallback?.id, source])

    return React.useMemo(() => {
        if (!source) return undefined
        if (!library) return { externalSubtitles: NO_SUBTITLES, onPlaybackError }
        if (!current) return undefined
        return { ...current.plan, onPlaybackError }
    }, [current, library, onPlaybackError, source])
}
