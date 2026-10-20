/**
 * HTML5 <video> backend for the web (LG webOS) build of ExpoMpvPlayer.
 *
 * It reproduces the parts of the mpv view's contract the app uses: the same
 * events, 1-based track ids, subtitle delay/visibility and zoom. Codec support
 * is whatever the TV's media pipeline offers; HLS plays natively where the
 * browser can (webOS) and through hls.js elsewhere, or always through hls.js
 * when the source asks for it (`preferMse`), so every request carries its headers.
 */
import Hls from "hls.js"
import type {
    AudioTrack,
    MpvChapter,
    MpvVideoSource,
    OnPlaybackStateChangePayload,
    OnProgressEventPayload,
    SubtitleTrack,
    TechnicalInfo,
} from "../MpvPlayer.types"
import { getSubtitleFeed, type SubtitleFeed } from "../subtitle-feed"
import { LibassRenderer, type AssChunk } from "./libass"
import { levelsAboveHeight, loadFailure, mediaOptionType, shouldReload, type SourceProbe } from "./media-pipeline"
import { activeCues, isAssScript, parseSubtitles, stripMarkup, type SubtitleCue } from "./subtitles"

export type WebVideoPlayerCallbacks = {
    onLoad: (payload: { url: string }) => void
    onProgress: (payload: OnProgressEventPayload) => void
    onPlaybackStateChange: (payload: OnPlaybackStateChangePayload) => void
    onError: (payload: { error: string; code?: number }) => void
    onTracksReady: () => void
    onSubtitleCues: (cues: SubtitleCue[]) => void
}

type SubtitleEntry = {
    title?: string
    lang?: string
    codec?: string
    /** In-band (or hls.js) track exposed by the browser. */
    textTrack?: TextTrack
    /** Sidecar file fetched and parsed by us. */
    url?: string
    cues?: SubtitleCue[]
    /** ASS track of a stream: its header and the packets so far (libass draws these). */
    ass?: { header: string; chunks: AssChunk[] }
    /** A sidecar file that is an ASS script (libass draws it). */
    assScript?: string
    loading?: Promise<void>
    /** Added with addSubtitleFile, so a reload of the same source keeps it. */
    added?: boolean
}

type BrowserAudioTrack = { enabled: boolean; label: string; language: string }
type BrowserAudioTrackList = { length: number; [index: number]: BrowserAudioTrack; addEventListener?: (type: string, listener: () => void) => void }

const MEDIA_ERRORS: Record<number, string> = {
    1: "Playback was aborted",
    2: "A network error interrupted playback",
    3: "The TV could not decode this video",
    4: "This video format is not supported by the TV's player",
}

function isHlsUrl(url: string) {
    return /\.m3u8($|[?#])/i.test(url) || /[?&]type=m3u8/i.test(url)
}

function fileTitle(url: string) {
    try {
        const name = decodeURIComponent(new URL(url, window.location.href).pathname.split("/").pop() ?? "")
        return name || undefined
    } catch {
        return undefined
    }
}

/** Headers the browser forbids scripts from setting; the stream request goes out without them. */
const FORBIDDEN_HEADERS = /^(referer|origin|host|cookie|user-agent|connection|content-length)$/i

/** How long a mediaOption <source> may take to reach loadedmetadata before plain `src` is used. */
const MEDIA_OPTION_TIMEOUT_MS = 8000

/** Set once a TV rejected mediaOption, so later loads go straight to `src`. */
let mediaOptionFailed = false

/** How many times hls.js may rebuild the media pipeline after a decode error, per load. */
const HLS_MEDIA_RECOVERIES = 2

/** How long the check of a source that failed to load may take. */
const PROBE_TIMEOUT_MS = 5000

function isHidden() {
    return typeof document !== "undefined" && document.hidden
}

function abortAfter(ms: number) {
    const controller = typeof AbortController === "undefined" ? null : new AbortController()
    const timer = setTimeout(() => controller?.abort(), ms)
    return {
        signal: controller?.signal,
        done: () => {
            clearTimeout(timer)
            // Stops the body download; only the status was wanted.
            controller?.abort()
        },
    }
}

/**
 * Asks for the source again to tell a server or network failure from a file
 * the TV can't play: a <video> reports both as MEDIA_ERR_SRC_NOT_SUPPORTED.
 */
async function probeSource(url: string, headers: Array<[string, string]>): Promise<SourceProbe> {
    const request = abortAfter(PROBE_TIMEOUT_MS)
    try {
        const response = await fetch(url, { headers, cache: "no-store", signal: request.signal })
        return { status: response.status }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "unknown"
        // CORS can hide the answer of a host that is up; a no-cors request only fails when it is not.
        try {
            await fetch(url, { mode: "no-cors", cache: "no-store", signal: request.signal })
            return "unknown"
        } catch (retryError) {
            return retryError instanceof DOMException && retryError.name === "AbortError" ? "unknown" : "unreachable"
        }
    } finally {
        request.done()
    }
}

function onWebOS() {
    if (typeof window === "undefined") return false
    const w = window as { webOSSystem?: unknown; PalmSystem?: unknown }
    return !!(w.webOSSystem || w.PalmSystem)
}

/** Where to pick up after the app went to the background. */
type Suspended = { position: number; subtitle: number; audio: number }

function isHlsSource(source: MpvVideoSource) {
    return source.isHls ?? isHlsUrl(source.url)
}

export class WebVideoPlayer {
    private hls: Hls | null = null
    private source: MpvVideoSource | null = null
    private subtitles: SubtitleEntry[] = []
    /** The source's subtitle feed: tracks whose cues arrive during playback. */
    private feed: SubtitleFeed | undefined
    private feedUnsubscribe: (() => void) | null = null
    /** Draw ASS tracks with libass rather than as text lines. */
    private assRendering = true
    private libass: LibassRenderer | null = null
    private libassStarting: Promise<void> | null = null
    /** The entry libass has loaded, and how many of its packets it was given. */
    private libassEntry: SubtitleEntry | null = null
    private libassChunkCount = 0
    private libassQueue: Promise<void> = Promise.resolve()
    /** libass failed to start or run on this TV; text lines are used from then on. */
    private static libassBroken = false
    private selectedSubtitle = 0
    private subtitleDelay = 0
    private subtitlesVisible = true
    private lastCueKey = ""
    private cueTimer: ReturnType<typeof setInterval> | null = null
    private readyToSeek = false
    private readonly listeners: Array<[string, EventListener]> = []
    private suspended: Suspended | null = null
    /** Tracks to select again once a reloaded source is ready. */
    private restoreTracks: Omit<Suspended, "position"> | null = null
    private mediaOptionSource: HTMLSourceElement | null = null
    private mediaOptionTimer: ReturnType<typeof setTimeout> | null = null
    /** The file is being loaded again without mediaOption; set if that works. */
    private mediaOptionRetry = false
    private hlsRecoveries = 0
    /** Bumped on every load, so late answers about an older source are dropped. */
    private loadId = 0
    private readonly onVisibilityChange = () => this.handleVisibilityChange()

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly callbacks: WebVideoPlayerCallbacks,
        /** Element over the video, sized like it, that holds libass's canvas. */
        private readonly subtitleHost?: HTMLElement,
    ) {
        const on = (type: string, listener: EventListener) => {
            video.addEventListener(type, listener)
            this.listeners.push([type, listener])
        }

        on("loadstart", () => this.state({ isLoading: true, eofReached: false }))
        on("loadedmetadata", () => this.onLoadedMetadata())
        on("canplay", () => {
            const firstReady = !this.readyToSeek
            this.readyToSeek = true
            this.state({ isLoading: false, isReadyToSeek: true })
            if (firstReady) {
                this.applyRestoredTracks()
                this.callbacks.onTracksReady()
            }
        })
        on("play", () => this.state({ isPaused: false }))
        on("playing", () => {
            this.state({ isPlaying: true, isPaused: false, isLoading: false })
            this.startCueTimer()
        })
        on("pause", () => {
            this.state({ isPlaying: false, isPaused: true })
            this.stopCueTimer()
        })
        on("waiting", () => this.state({ isLoading: true }))
        on("seeking", () => this.state({ isLoading: true }))
        on("seeked", () => {
            if (video.readyState >= 3 || video.paused) this.state({ isLoading: false })
            this.updateCues()
            this.notifyFeed("seeked")
        })
        on("ended", () => this.state({ eofReached: true, isPaused: true, isPlaying: false }))
        on("ratechange", () => this.state({ speed: video.playbackRate }))
        on("timeupdate", () => {
            this.emitProgress()
            this.updateCues()
        })
        on("durationchange", () => this.emitProgress())
        on("error", () => {
            const error = video.error
            const source = this.source
            if (!error || !source) return
            // MSE decode errors reach the element, not hls.js's ERROR event.
            if (this.hls && error.code === 3 && this.recoverHlsMediaError()) return
            const message = error.message || MEDIA_ERRORS[error.code] || "Playback failed"
            if (error.code === 4 && !this.hls) {
                void this.reportLoadFailure(source, message)
                return
            }
            this.callbacks.onError({ error: message, code: error.code })
        })

        video.textTracks.addEventListener?.("addtrack", () => this.callbacks.onTracksReady())
        const audioTracks = this.audioTrackList()
        audioTracks?.addEventListener?.("addtrack", () => this.callbacks.onTracksReady())

        if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibilityChange)
    }

    ///////////////////////////////////////////////////////////////////////////
    // Loading
    ///////////////////////////////////////////////////////////////////////////

    load(source: MpvVideoSource) {
        this.reset()
        this.source = source
        this.subtitles = (source.externalSubtitles ?? []).map(sub => ({
            url: sub.url,
            title: sub.title ?? fileTitle(sub.url),
            lang: sub.lang,
        }))
        this.assRendering = source.assRendering !== false
        this.feed = getSubtitleFeed(source.subtitleFeed)
        if (this.feed) {
            // The feed fills these arrays in place; the cues are shown as they come in.
            for (const track of this.feed.tracks) {
                this.subtitles.push({ title: track.title, lang: track.lang, codec: track.codec, cues: track.cues, ass: track.ass })
            }
            this.feedUnsubscribe = this.feed.subscribe(() => {
                this.syncLibass()
                this.updateCues(true)
            })
        }

        const { video } = this
        video.autoplay = false
        this.loadId++
        const headers = this.requestHeaders(source)
        // The TV's own HLS player can't add headers to playlist and segment
        // requests, and a file:// app has to authenticate every request to
        // the Seanime server, so its streams ask for hls.js (`preferMse`).
        // Other streams keep the native player: hls.js requests are subject
        // to CORS, which third-party hosts may not allow.
        const useHlsJs = isHlsSource(source) && Hls.isSupported()
            && (source.preferMse || !video.canPlayType("application/vnd.apple.mpegurl"))

        if (useHlsJs) {
            const hls = new Hls({
                startPosition: source.startPosition ?? -1,
                xhrSetup: (xhr) => {
                    for (const [name, value] of headers) xhr.setRequestHeader(name, value)
                },
            })
            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.callbacks.onTracksReady())
            hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.callbacks.onTracksReady())
            const maxHeight = source.maxVideoHeight
            if (maxHeight) {
                // The server's transcode lists the original (maybe 4K) first;
                // a Full HD TV can't decode those, so ABR must not pick them.
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    const drop = levelsAboveHeight(hls.levels.map(level => level.height), maxHeight)
                    for (const index of drop) hls.removeLevel(index)
                })
            }
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal) return
                if (data.type !== Hls.ErrorTypes.MEDIA_ERROR) {
                    this.callbacks.onError({ error: `HLS ${data.type}: ${data.details}` })
                    return
                }
                // A decoder hiccup is worth a retry or two; codecs the browser
                // doesn't have are not, and would otherwise retry forever.
                if (data.details !== Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR && this.recoverHlsMediaError()) return
                this.callbacks.onError({ error: `${MEDIA_ERRORS[3]} (${data.details})`, code: 3 })
            })
            hls.loadSource(source.url)
            hls.attachMedia(video)
            this.hls = hls
        } else if (this.canUseMediaOption(source)) {
            this.loadWithMediaOption(source)
        } else {
            video.src = source.url
            video.load()
        }
    }

    unload() {
        this.reset()
    }

    private requestHeaders(source: MpvVideoSource): Array<[string, string]> {
        return Object.entries(source.headers ?? {}).filter(([name]) => !FORBIDDEN_HEADERS.test(name))
    }

    private recoverHlsMediaError() {
        if (!this.hls || this.hlsRecoveries >= HLS_MEDIA_RECOVERIES) return false
        this.hlsRecoveries++
        console.warn("[web-video-player] media error; rebuilding the HLS pipeline", this.hlsRecoveries)
        this.hls.recoverMediaError()
        return true
    }

    /** A source that didn't load: say so when it was the server or network, not the format. */
    private async reportLoadFailure(source: MpvVideoSource, message: string) {
        const loadId = this.loadId
        const probe = await probeSource(source.url, this.requestHeaders(source))
        if (loadId !== this.loadId || !this.source) return
        this.callbacks.onError(loadFailure(probe) ?? { error: message, code: 4 })
    }

    destroy() {
        this.reset()
        for (const [type, listener] of this.listeners) this.video.removeEventListener(type, listener)
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibilityChange)
    }

    private reset() {
        this.stopCueTimer()
        this.feedUnsubscribe?.()
        this.feedUnsubscribe = null
        this.feed = undefined
        // A new source may carry other fonts.
        this.destroyLibass()
        this.hls?.destroy()
        this.hls = null
        this.source = null
        this.subtitles = []
        this.selectedSubtitle = 0
        this.readyToSeek = false
        this.lastCueKey = ""
        this.suspended = null
        this.restoreTracks = null
        this.mediaOptionRetry = false
        this.hlsRecoveries = 0
        this.clearMediaOption()
        this.callbacks.onSubtitleCues([])
        this.video.pause()
        this.video.removeAttribute("src")
        while (this.video.firstChild) this.video.removeChild(this.video.firstChild)
        this.video.load()
    }

    private onLoadedMetadata() {
        const source = this.source
        if (!source) return
        this.notifyFeed("loadedmetadata")

        const usedMediaOption = !!this.mediaOptionSource
        this.clearMediaOptionTimer()
        if (this.mediaOptionRetry) {
            // The file plays without mediaOption, so it was mediaOption the TV refused.
            this.mediaOptionRetry = false
            mediaOptionFailed = true
        }
        const start = source.startPosition ?? 0
        // With mediaOption the TV already started there; desktop browsers ignore it.
        const alreadyThere = usedMediaOption && Math.abs(this.video.currentTime - start) <= 2
        if (!this.hls && start > 0 && !alreadyThere) {
            this.video.currentTime = start
        }
        this.callbacks.onLoad({ url: source.url })
        // The rate carries over loads (defaultPlaybackRate) with no ratechange to say so.
        this.state({ speed: this.video.playbackRate })
        this.emitProgress()
        this.callbacks.onTracksReady()

        // A load that finishes while the app is hidden stays paused.
        if (source.autoplay !== false && !isHidden()) {
            void this.play()
        } else {
            this.state({ isPaused: true })
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Resuming with webOS mediaOption
    ///////////////////////////////////////////////////////////////////////////

    private canUseMediaOption(source: MpvVideoSource) {
        return !mediaOptionFailed && onWebOS() && !isHlsSource(source)
            && (source.startPosition ?? 0) > 0 && this.video.canPlayType("video/mp4") !== ""
    }

    /**
     * Hands the start position to the TV's media pipeline in the <source>
     * type. If the TV refuses it, or nothing loads within a few seconds, the
     * file is loaded again the usual way and seeked after loadedmetadata.
     */
    private loadWithMediaOption(source: MpvVideoSource) {
        const element = document.createElement("source")
        element.src = source.url
        element.type = mediaOptionType(source.startPosition ?? 0)
        element.addEventListener("error", () => this.fallBackFromMediaOption(element))
        this.mediaOptionSource = element
        this.video.appendChild(element)
        this.video.load()
        this.mediaOptionTimer = setTimeout(() => this.fallBackFromMediaOption(element), MEDIA_OPTION_TIMEOUT_MS)
    }

    private fallBackFromMediaOption(element: HTMLSourceElement) {
        if (this.mediaOptionSource !== element || !this.source) return
        console.warn("[web-video-player] mediaOption was not accepted; loading the file without it")
        // Only remembered once the file loads without it: a file the TV
        // can't play fails the same way and says nothing about mediaOption.
        this.mediaOptionRetry = true
        this.clearMediaOption()
        this.video.src = this.source.url
        this.video.load()
    }

    private clearMediaOptionTimer() {
        if (this.mediaOptionTimer !== null) clearTimeout(this.mediaOptionTimer)
        this.mediaOptionTimer = null
    }

    private clearMediaOption() {
        this.clearMediaOptionTimer()
        this.mediaOptionSource?.remove()
        this.mediaOptionSource = null
    }

    ///////////////////////////////////////////////////////////////////////////
    // Background and foreground
    ///////////////////////////////////////////////////////////////////////////

    /**
     * webOS suspends a hidden app and may hand the hardware decoder to
     * whatever took the screen. Hidden: pause where we are (the pause event
     * records the position like a user pause). Visible again: reload at that
     * position if the pipeline was released, and stay paused either way, as
     * TV apps come back paused with the controls up. Resuming on its own is
     * deliberately not done.
     */
    private handleVisibilityChange() {
        if (!this.source) return
        const { video } = this

        if (document.hidden) {
            // A load still in flight comes up paused (and so does a fallback reload).
            this.source = { ...this.source, autoplay: false }
            this.suspended = {
                // Before loadedmetadata, currentTime is 0, not where the source starts.
                position: video.readyState >= 1 ? video.currentTime : (this.source.startPosition ?? 0),
                subtitle: this.selectedSubtitle,
                audio: this.getCurrentAudioTrack(),
            }
            this.stopCueTimer()
            this.pause()
            return
        }

        const suspended = this.suspended
        this.suspended = null
        if (!suspended || !shouldReload(video.readyState, video.networkState, !!video.error)) return

        const source = this.source
        const added = this.subtitles.filter(entry => entry.added)
        this.load({ ...source, startPosition: suspended.position, autoplay: false })
        // Files added with addSubtitleFile come after the source's own, as before.
        for (const entry of added) this.subtitles.push({ url: entry.url, title: entry.title, cues: entry.cues, assScript: entry.assScript, added: true })
        this.restoreTracks = { subtitle: suspended.subtitle, audio: suspended.audio }
    }

    private applyRestoredTracks() {
        const restore = this.restoreTracks
        this.restoreTracks = null
        if (!restore) return
        if (restore.audio > 0) this.setAudioTrack(restore.audio)
        if (restore.subtitle > 0) this.setSubtitleTrack(restore.subtitle)
    }

    ///////////////////////////////////////////////////////////////////////////
    // Playback
    ///////////////////////////////////////////////////////////////////////////

    async play() {
        try {
            await this.video.play()
        } catch (error) {
            // Desktop browsers block unmuted autoplay; TVs do not.
            if (error instanceof DOMException && error.name === "NotAllowedError") {
                this.state({ isPaused: true })
                return
            }
            throw error
        }
    }

    pause() {
        this.video.pause()
    }

    seekTo(position: number) {
        const duration = this.duration()
        this.video.currentTime = Math.max(0, duration > 0 ? Math.min(position, duration - 0.25) : position)
    }

    seekBy(offset: number) {
        this.seekTo(this.video.currentTime + offset)
    }

    setSpeed(speed: number) {
        // load() resets playbackRate to defaultPlaybackRate without a ratechange,
        // so a reload after the background would drop back to 1x unseen.
        this.video.defaultPlaybackRate = speed
        this.video.playbackRate = speed
    }

    getSpeed() {
        return this.video.playbackRate
    }

    isPaused() {
        return this.video.paused
    }

    getCurrentPosition() {
        return this.video.currentTime
    }

    duration() {
        const value = this.video.duration
        return Number.isFinite(value) ? value : 0
    }

    private bufferedAhead() {
        const { buffered, currentTime } = this.video
        for (let i = 0; i < buffered.length; i++) {
            if (buffered.start(i) <= currentTime + 0.5 && buffered.end(i) >= currentTime) {
                return Math.max(0, buffered.end(i) - currentTime)
            }
        }
        return 0
    }

    private emitProgress() {
        this.callbacks.onProgress({
            position: this.video.currentTime,
            duration: this.duration(),
            cacheSeconds: this.bufferedAhead(),
        })
    }

    private state(payload: OnPlaybackStateChangePayload) {
        this.callbacks.onPlaybackStateChange(payload)
    }

    ///////////////////////////////////////////////////////////////////////////
    // Audio
    ///////////////////////////////////////////////////////////////////////////

    private audioTrackList(): BrowserAudioTrackList | null {
        return (this.video as HTMLVideoElement & { audioTracks?: BrowserAudioTrackList }).audioTracks ?? null
    }

    getAudioTracks(): AudioTrack[] {
        if (this.hls) {
            return this.hls.audioTracks.map((track, index) => ({
                id: index + 1,
                title: track.name,
                lang: track.lang,
                codec: track.audioCodec,
                selected: index === this.hls?.audioTrack,
            }))
        }

        const list = this.audioTrackList()
        if (!list) return []
        const tracks: AudioTrack[] = []
        for (let i = 0; i < list.length; i++) {
            tracks.push({ id: i + 1, title: list[i].label || undefined, lang: list[i].language || undefined, selected: list[i].enabled })
        }
        return tracks
    }

    setAudioTrack(id: number) {
        if (this.hls) {
            this.hls.audioTrack = id - 1
            return
        }
        const list = this.audioTrackList()
        if (!list) return
        for (let i = 0; i < list.length; i++) list[i].enabled = i === id - 1
    }

    getCurrentAudioTrack() {
        return this.getAudioTracks().find(track => track.selected)?.id ?? 0
    }

    ///////////////////////////////////////////////////////////////////////////
    // Subtitles
    ///////////////////////////////////////////////////////////////////////////

    /** Picks up text tracks the browser (or hls.js) exposes, keeping ids stable. */
    private syncTextTracks() {
        const known = new Set(this.subtitles.map(entry => entry.textTrack).filter(Boolean))
        const added: SubtitleEntry[] = []
        const tracks = this.video.textTracks
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i]
            if (known.has(track) || (track.kind !== "subtitles" && track.kind !== "captions")) continue
            track.mode = "disabled"
            added.push({ textTrack: track, title: track.label || undefined, lang: track.language || undefined })
        }
        if (added.length > 0) {
            // In-band tracks come first, like mpv lists them.
            const inBand = this.subtitles.filter(entry => entry.textTrack)
            const sidecar = this.subtitles.filter(entry => !entry.textTrack)
            const selected = this.subtitles[this.selectedSubtitle - 1]
            this.subtitles = [...inBand, ...added, ...sidecar]
            this.selectedSubtitle = selected ? this.subtitles.indexOf(selected) + 1 : 0
        }
    }

    getSubtitleTracks(): SubtitleTrack[] {
        this.syncTextTracks()
        return this.subtitles.map((entry, index) => ({
            id: index + 1,
            title: entry.title,
            lang: entry.lang,
            codec: entry.codec,
            selected: index + 1 === this.selectedSubtitle,
        }))
    }

    getCurrentSubtitleTrack() {
        return this.selectedSubtitle
    }

    setSubtitleTrack(id: number) {
        this.syncTextTracks()
        this.selectedSubtitle = id > 0 && id <= this.subtitles.length ? id : 0
        this.subtitles.forEach((entry, index) => {
            if (entry.textTrack) entry.textTrack.mode = index + 1 === this.selectedSubtitle ? "hidden" : "disabled"
        })

        const entry = this.subtitles[this.selectedSubtitle - 1]
        if (entry?.url && !entry.cues) void this.loadSidecar(entry)
        this.syncLibass()
        this.updateCues(true)
    }

    disableSubtitles() {
        this.setSubtitleTrack(0)
    }

    async addSubtitleFile(url: string, select: boolean) {
        const entry: SubtitleEntry = { url, title: fileTitle(url), added: true }
        this.subtitles.push(entry)
        await this.loadSidecar(entry)
        if (select) this.setSubtitleTrack(this.subtitles.indexOf(entry) + 1)
    }

    private loadSidecar(entry: SubtitleEntry) {
        if (!entry.url) return Promise.resolve()
        entry.loading ??= fetch(entry.url)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                return response.text()
            })
            .then(text => {
                entry.cues = parseSubtitles(text)
                if (isAssScript(text)) entry.assScript = text
                this.syncLibass()
                this.updateCues(true)
            })
            .catch(error => {
                entry.cues = []
                console.warn("[web-video-player] Could not load subtitles", entry.url, error)
            })
        return entry.loading
    }

    setSubtitleDelay(delay: number) {
        this.subtitleDelay = delay
        this.state({ subtitleDelay: delay })
        this.libass?.setDelay(delay)
        this.updateCues(true)
    }

    setSubtitleVisibility(visible: boolean) {
        this.subtitlesVisible = visible
        this.syncLibass()
        this.updateCues(true)
    }

    setAssRendering(enabled: boolean) {
        this.assRendering = enabled
        // Turning it on again is also how to retry after a failure.
        if (enabled) WebVideoPlayer.libassBroken = false
        this.syncLibass()
        this.updateCues(true)
    }

    ///////////////////////////////////////////////////////////////////////////
    // libass
    ///////////////////////////////////////////////////////////////////////////

    /** Whether libass is drawing `entry`, so its text lines stay hidden. */
    private libassDraws(entry: SubtitleEntry) {
        return this.libass !== null && this.libassEntry === entry
    }

    /** Gives libass the selected track (and its new packets), or clears it. */
    private syncLibass() {
        const entry = this.subtitles[this.selectedSubtitle - 1]
        const wanted = !!entry && (!!entry.ass || !!entry.assScript)
            && this.subtitlesVisible && this.assRendering && !WebVideoPlayer.libassBroken && !!this.subtitleHost && !!this.source
        const libass = this.libass

        if (!wanted) {
            if (libass && this.libassEntry) {
                this.libassEntry = null
                this.runLibass(renderer => renderer.setTrack(null))
            }
            libass?.setVisible(false)
            return
        }
        if (!libass) {
            this.startLibass()
            return
        }

        libass.setVisible(true)
        if (this.libassEntry !== entry) {
            this.libassEntry = entry
            this.libassChunkCount = 0
            const script = entry.ass?.header ?? entry.assScript ?? null
            this.runLibass(renderer => renderer.setTrack(script))
        }
        const chunks = entry.ass?.chunks
        if (chunks && chunks.length > this.libassChunkCount) {
            const pending = chunks.slice(this.libassChunkCount)
            this.libassChunkCount = chunks.length
            this.runLibass(renderer => renderer.addChunks(pending))
        }
    }

    private startLibass() {
        if (this.libassStarting || !this.subtitleHost) return
        const loadId = this.loadId
        this.libassStarting = LibassRenderer.create(this.video, this.subtitleHost, this.source?.subtitleFonts ?? []).then((renderer) => {
            if (loadId !== this.loadId || !this.source) {
                renderer.destroy()
                return
            }
            this.libassStarting = null
            renderer.setDelay(this.subtitleDelay)
            this.libass = renderer
            this.libassEntry = null
            this.syncLibass()
            this.updateCues(true)
        }, (error: unknown) => {
            if (loadId !== this.loadId) return
            this.libassStarting = null
            this.libassFailed(error)
        })
    }

    /** Runs libass calls one after another; a failure falls back to text lines. */
    private runLibass(action: (renderer: LibassRenderer) => Promise<void>) {
        const renderer = this.libass
        if (!renderer) return
        this.libassQueue = this.libassQueue
            .then(() => this.libass === renderer ? action(renderer) : undefined)
            .catch((error: unknown) => {
                if (this.libass === renderer) this.libassFailed(error)
            })
    }

    private libassFailed(error: unknown) {
        console.warn("[web-video-player] libass is unavailable; showing subtitles as text", error)
        WebVideoPlayer.libassBroken = true
        this.destroyLibass()
        this.updateCues(true)
    }

    private destroyLibass() {
        this.libass?.destroy()
        this.libass = null
        this.libassStarting = null
        this.libassEntry = null
        this.libassChunkCount = 0
        this.libassQueue = Promise.resolve()
    }

    private notifyFeed(type: "loadedmetadata" | "seeked") {
        const { video } = this
        this.feed?.onPlayerEvent?.({ type, position: video.currentTime, duration: video.duration, paused: video.paused })
    }

    private currentCues(): SubtitleCue[] {
        const entry = this.subtitles[this.selectedSubtitle - 1]
        if (!entry || !this.subtitlesVisible || this.libassDraws(entry)) return []

        const time = this.video.currentTime - this.subtitleDelay
        if (entry.cues) return activeCues(entry.cues, time)

        const list = entry.textTrack?.cues
        if (!list) return []
        const cues: SubtitleCue[] = []
        for (let i = 0; i < list.length; i++) {
            const cue = list[i] as TextTrackCue & { text?: string }
            if (cue.startTime <= time && cue.endTime > time && cue.text) {
                // WebVTT cue text keeps its tags and entities ("Tom &amp; Jerry").
                const text = stripMarkup(cue.text)
                if (text) cues.push({ start: cue.startTime, end: cue.endTime, text })
            }
        }
        return cues
    }

    private updateCues(force = false) {
        const cues = this.currentCues()
        const key = cues.map(cue => `${cue.start}:${cue.text}`).join("|")
        if (!force && key === this.lastCueKey) return
        this.lastCueKey = key
        this.callbacks.onSubtitleCues(cues)
    }

    private startCueTimer() {
        // timeupdate only fires about four times a second.
        this.cueTimer ??= setInterval(() => this.updateCues(), 100)
    }

    private stopCueTimer() {
        if (this.cueTimer !== null) clearInterval(this.cueTimer)
        this.cueTimer = null
    }

    ///////////////////////////////////////////////////////////////////////////
    // Info
    ///////////////////////////////////////////////////////////////////////////

    getChapters(): MpvChapter[] {
        return this.source?.chapters ?? []
    }

    getTechnicalInfo(): TechnicalInfo {
        const quality = this.video.getVideoPlaybackQuality?.()
        const summary = this.source?.mediaInfoSummary
        const engine = this.hls ? "html5+hls.js" : "html5"
        const mode = summary ? (summary.mode === "transcode" ? " · transcode" : " · direct play") : ""
        return {
            videoWidth: this.video.videoWidth || undefined,
            videoHeight: this.video.videoHeight || undefined,
            videoCodec: summary?.videoCodec,
            audioCodec: summary?.audioCodec,
            cacheSeconds: this.bufferedAhead(),
            droppedFrames: quality?.droppedVideoFrames,
            isBuffering: this.video.readyState < 3,
            voDriver: engine + mode,
            hwdec: "browser",
            playbackNote: summary?.reasons?.length ? summary.reasons.join(", ") : undefined,
            device: summary?.device,
        }
    }
}
