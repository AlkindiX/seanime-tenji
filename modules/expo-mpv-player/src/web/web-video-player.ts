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
import { mediaOptionType, shouldReload } from "./media-pipeline"
import { activeCues, parseSubtitles, stripMarkup, type SubtitleCue } from "./subtitles"

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
    loading?: Promise<void>
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

function onWebOS() {
    if (typeof window === "undefined") return false
    const w = window as { webOSSystem?: unknown; PalmSystem?: unknown }
    return !!(w.webOSSystem || w.PalmSystem)
}

/** Where to pick up after the app went to the background. */
type Suspended = { position: number; subtitle: number; audio: number }

export class WebVideoPlayer {
    private hls: Hls | null = null
    private source: MpvVideoSource | null = null
    private subtitles: SubtitleEntry[] = []
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
    private readonly onVisibilityChange = () => this.handleVisibilityChange()

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly callbacks: WebVideoPlayerCallbacks,
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
            if (!error || !this.source) return
            this.callbacks.onError({ error: error.message || MEDIA_ERRORS[error.code] || "Playback failed", code: error.code })
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

        const { video } = this
        video.autoplay = false
        const headers = Object.entries(source.headers ?? {}).filter(([name]) => !FORBIDDEN_HEADERS.test(name))
        // The TV's own HLS player can't add headers to playlist and segment
        // requests, and a file:// app has to authenticate every request to
        // the Seanime server, so its streams ask for hls.js (`preferMse`).
        // Other streams keep the native player: hls.js requests are subject
        // to CORS, which third-party hosts may not allow.
        const useHlsJs = isHlsUrl(source.url) && Hls.isSupported()
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
            let recoveries = 0
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal) return
                if (data.type !== Hls.ErrorTypes.MEDIA_ERROR) {
                    this.callbacks.onError({ error: `HLS ${data.type}: ${data.details}` })
                    return
                }
                // A decoder hiccup is worth a retry or two; codecs the browser
                // doesn't have are not, and would otherwise retry forever.
                if (data.details !== Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR && recoveries++ < 2) {
                    hls.recoverMediaError()
                    return
                }
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

    destroy() {
        this.reset()
        for (const [type, listener] of this.listeners) this.video.removeEventListener(type, listener)
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibilityChange)
    }

    private reset() {
        this.stopCueTimer()
        this.hls?.destroy()
        this.hls = null
        this.source = null
        this.subtitles = []
        this.selectedSubtitle = 0
        this.readyToSeek = false
        this.lastCueKey = ""
        this.suspended = null
        this.restoreTracks = null
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

        const usedMediaOption = !!this.mediaOptionSource
        this.clearMediaOptionTimer()
        const start = source.startPosition ?? 0
        // With mediaOption the TV already started there; desktop browsers ignore it.
        const alreadyThere = usedMediaOption && Math.abs(this.video.currentTime - start) <= 2
        if (!this.hls && start > 0 && !alreadyThere) {
            this.video.currentTime = start
        }
        this.callbacks.onLoad({ url: source.url })
        this.emitProgress()
        this.callbacks.onTracksReady()

        if (source.autoplay !== false) {
            void this.play()
        } else {
            this.state({ isPaused: true })
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Resuming with webOS mediaOption
    ///////////////////////////////////////////////////////////////////////////

    private canUseMediaOption(source: MpvVideoSource) {
        return !mediaOptionFailed && onWebOS() && !isHlsUrl(source.url)
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
        mediaOptionFailed = true
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
            this.suspended = {
                position: video.currentTime,
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
        this.load({ ...source, startPosition: suspended.position, autoplay: false })
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
        this.updateCues(true)
    }

    disableSubtitles() {
        this.setSubtitleTrack(0)
    }

    async addSubtitleFile(url: string, select: boolean) {
        const entry: SubtitleEntry = { url, title: fileTitle(url) }
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
        this.updateCues(true)
    }

    setSubtitleVisibility(visible: boolean) {
        this.subtitlesVisible = visible
        this.updateCues(true)
    }

    private currentCues(): SubtitleCue[] {
        const entry = this.subtitles[this.selectedSubtitle - 1]
        if (!entry || !this.subtitlesVisible) return []

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
