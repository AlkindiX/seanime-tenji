import React from "react"
import { View } from "react-native"
import type {
    MpvPlayerViewProps,
    MpvPlayerViewRef,
    SubtitleHorizontalAlignment,
    SubtitleVerticalAlignment,
} from "./MpvPlayer.types"
import type { SubtitleCue, SubtitleImage } from "./web/subtitles"
import { WebVideoPlayer } from "./web/web-video-player"

type SubtitleStyle = {
    /** mpv sub-font-size: pixels at a 720p reference height. */
    fontSize: number
    scale: number
    /** mpv sub-pos: 0 (top) to 100 (bottom). */
    position: number
    /** mpv sub-margin-y, also at 720p. */
    marginY: number
    alignX: SubtitleHorizontalAlignment
    alignY: SubtitleVerticalAlignment
}

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
    fontSize: 48,
    scale: 1,
    position: 100,
    marginY: 22,
    alignX: "center",
    alignY: "bottom",
}

const OUTLINE = [
    "-2px -2px 0 #000", "2px -2px 0 #000", "-2px 2px 0 #000", "2px 2px 0 #000",
    "0 2px 0 #000", "0 -2px 0 #000", "2px 0 0 #000", "-2px 0 0 #000",
    "0 0 6px rgba(0,0,0,0.8)",
].join(", ")

type Size = { width: number; height: number }

/** Where a `contain`-fitted video's picture sits in the view. */
function pictureRect(view: Size, video: Size) {
    if (!view.width || !view.height || !video.width || !video.height) return null
    const scale = Math.min(view.width / video.width, view.height / video.height)
    const width = video.width * scale
    const height = video.height * scale
    return { left: (view.width - width) / 2, top: (view.height - height) / 2, width, height }
}

/** How much `cover` (zoomed to fill) enlarges the picture compared with `contain`. */
function coverFactor(view: Size, video: Size) {
    if (!view.width || !view.height || !video.width || !video.height) return 1
    const x = view.width / video.width
    const y = view.height / video.height
    return Math.max(x, y) / Math.min(x, y)
}

const percent = (value: number, of: number) => `${(value / of) * 100}%`

/** Image subtitles (PGS), placed on the video's own pixel grid inside the picture. */
function ImageSubtitle({ image, video }: { image: SubtitleImage; video: Size }) {
    const canvasWidth = image.canvasWidth || video.width || 1920
    const canvasHeight = image.canvasHeight || video.height || 1080
    const crop = image.crop
    const width = crop?.width ?? image.width
    const height = crop?.height ?? image.height
    return (
        <div
            style={{
                position: "absolute",
                left: percent(image.x, canvasWidth),
                top: percent(image.y, canvasHeight),
                width: percent(width, canvasWidth),
                height: percent(height, canvasHeight),
                overflow: "hidden",
            }}
        >
            <img
                src={image.src}
                alt=""
                style={{
                    position: "absolute",
                    left: crop ? percent(-crop.x, width) : 0,
                    top: crop ? percent(-crop.y, height) : 0,
                    width: percent(image.width, width),
                    height: percent(image.height, height),
                }}
            />
        </div>
    )
}

function SubtitleOverlay({ cues, style, height }: { cues: SubtitleCue[]; style: SubtitleStyle; height: number }) {
    cues = cues.filter(cue => !cue.image)
    if (cues.length === 0 || height <= 0) return null

    const unit = height / 720
    const fontSize = Math.round(style.fontSize * style.scale * unit)
    const top = cues.filter(cue => cue.top || style.alignY === "top")
    const bottom = cues.filter(cue => !cue.top && style.alignY !== "top")
    const edge = style.marginY * unit + (100 - style.position) / 100 * height

    const block = (items: SubtitleCue[], placement: React.CSSProperties) => items.length > 0 && (
        <div
            style={{
                position: "absolute",
                left: "5%",
                right: "5%",
                display: "flex",
                flexDirection: "column",
                alignItems: style.alignX === "left" ? "flex-start" : style.alignX === "right" ? "flex-end" : "center",
                pointerEvents: "none",
                ...placement,
            }}
        >
            {items.map((cue, index) => (
                <div
                    key={`${cue.start}-${index}`}
                    style={{
                        color: "#ffffff",
                        fontFamily: "sans-serif",
                        fontWeight: 600,
                        fontSize,
                        lineHeight: 1.25,
                        textAlign: style.alignX,
                        whiteSpace: "pre-line",
                        textShadow: OUTLINE,
                    }}
                >
                    {cue.text}
                </div>
            ))}
        </div>
    )

    return (
        <>
            {block(top, { top: style.marginY * unit })}
            {block(bottom, style.alignY === "center" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: edge })}
        </>
    )
}

/**
 * Web stand-in for the libmpv view (used by the LG webOS build): a <video>
 * element driven by {@link WebVideoPlayer} with the same props, events and
 * imperative handle as the native view.
 */
export const MpvPlayerView = React.forwardRef<MpvPlayerViewRef, MpvPlayerViewProps>(function MpvPlayerView({
    source,
    nowPlayingMetadata,
    videoOutput: _videoOutput,
    onLoad,
    onProgress,
    onPlaybackStateChange,
    onError,
    onTracksReady,
    onPictureInPictureChange: _onPictureInPictureChange,
    style,
    ...viewProps
}, ref) {
    const videoRef = React.useRef<HTMLVideoElement | null>(null)
    const playerRef = React.useRef<WebVideoPlayer | null>(null)
    const [cues, setCues] = React.useState<SubtitleCue[]>([])
    const [subtitleStyle, setSubtitleStyle] = React.useState(DEFAULT_SUBTITLE_STYLE)
    const [viewSize, setViewSize] = React.useState<Size>({ width: 0, height: 0 })
    const height = viewSize.height
    const [videoSize, setVideoSize] = React.useState<Size>({ width: 0, height: 0 })
    const subtitleHostRef = React.useRef<HTMLDivElement | null>(null)
    const [zoom, setZoom] = React.useState({ scale: 1, fill: false })
    const zoomRef = React.useRef(zoom)
    zoomRef.current = zoom

    const handlers = React.useRef({ onLoad, onProgress, onPlaybackStateChange, onError, onTracksReady })
    handlers.current = { onLoad, onProgress, onPlaybackStateChange, onError, onTracksReady }

    React.useLayoutEffect(() => {
        const video = videoRef.current
        if (!video) return

        const player = new WebVideoPlayer(video, {
            onLoad: nativeEvent => handlers.current.onLoad?.({ nativeEvent }),
            onProgress: nativeEvent => handlers.current.onProgress?.({ nativeEvent }),
            onPlaybackStateChange: nativeEvent => handlers.current.onPlaybackStateChange?.({ nativeEvent }),
            onError: nativeEvent => handlers.current.onError?.({ nativeEvent }),
            onTracksReady: () => handlers.current.onTracksReady?.({ nativeEvent: {} }),
            onSubtitleCues: setCues,
        }, subtitleHostRef.current ?? undefined)
        playerRef.current = player

        const updateVideoSize = () => setVideoSize({ width: video.videoWidth, height: video.videoHeight })
        video.addEventListener("loadedmetadata", updateVideoSize)
        video.addEventListener("resize", updateVideoSize)

        return () => {
            video.removeEventListener("loadedmetadata", updateVideoSize)
            video.removeEventListener("resize", updateVideoSize)
            player.destroy()
            playerRef.current = null
        }
    }, [])

    const sourceKey = source ? `${source.url}\n${source.startPosition ?? 0}` : null
    const sourceRef = React.useRef(source)
    sourceRef.current = source

    React.useEffect(() => {
        const player = playerRef.current
        if (!player) return
        if (sourceRef.current) player.load(sourceRef.current)
        else player.unload()
    }, [sourceKey])

    React.useEffect(() => {
        const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined
        if (!session || typeof MediaMetadata === "undefined" || !nowPlayingMetadata) return
        session.metadata = new MediaMetadata({
            title: nowPlayingMetadata.title,
            artist: nowPlayingMetadata.artist,
            album: nowPlayingMetadata.albumTitle,
            artwork: nowPlayingMetadata.artworkUri ? [{ src: nowPlayingMetadata.artworkUri }] : [],
        })
    }, [nowPlayingMetadata])

    React.useImperativeHandle(ref, () => {
        const player = () => {
            const current = playerRef.current
            if (!current) throw new Error("ExpoMpvPlayer web view is not mounted")
            return current
        }
        const run = async (action: (current: WebVideoPlayer) => unknown) => {
            await action(player())
        }
        const updateStyle = async (patch: Partial<SubtitleStyle>) => {
            setSubtitleStyle(current => ({ ...current, ...patch }))
        }

        return {
            play: () => run(p => p.play()),
            pause: () => run(p => p.pause()),
            seekTo: position => run(p => p.seekTo(position)),
            seekBy: offset => run(p => p.seekBy(offset)),
            setSpeed: speed => run(p => p.setSpeed(speed)),
            getSpeed: async () => player().getSpeed(),
            isPaused: async () => player().isPaused(),
            getCurrentPosition: async () => player().getCurrentPosition(),
            getDuration: async () => player().duration(),

            // TV browsers have no picture-in-picture.
            startPictureInPicture: async () => {},
            stopPictureInPicture: async () => {},
            isPictureInPictureSupported: async () => false,
            isPictureInPictureActive: async () => false,

            getSubtitleTracks: async () => player().getSubtitleTracks(),
            getChapters: async () => player().getChapters(),
            setSubtitleTrack: trackId => run(p => p.setSubtitleTrack(trackId)),
            disableSubtitles: () => run(p => p.disableSubtitles()),
            getCurrentSubtitleTrack: async () => player().getCurrentSubtitleTrack(),
            addSubtitleFile: (url, select) => run(p => p.addSubtitleFile(url, select)),
            setSubtitleDelay: delay => run(p => p.setSubtitleDelay(delay)),
            setSubtitleFontSize: fontSize => updateStyle({ fontSize }),
            setSubtitleVisibility: visible => run(p => p.setSubtitleVisibility(visible)),
            setSubtitlePosition: position => updateStyle({ position }),
            setSubtitleScale: scale => updateStyle({ scale }),
            setSubtitleMarginY: marginY => updateStyle({ marginY }),
            setSubtitleAlignX: alignX => updateStyle({ alignX }),
            setSubtitleAlignY: alignY => updateStyle({ alignY }),
            setAssRendering: enabled => run(p => p.setAssRendering(enabled)),

            getAudioTracks: async () => player().getAudioTracks(),
            setAudioTrack: trackId => run(p => p.setAudioTrack(trackId)),
            getCurrentAudioTrack: async () => player().getCurrentAudioTrack(),
            // Browsers cannot shift audio against video.
            setAudioDelay: async () => {},

            setVideoZoom: async scale => setZoom(current => ({ ...current, scale })),
            setZoomedToFill: async fill => setZoom(current => ({ ...current, fill })),
            isZoomedToFill: async () => zoomRef.current.fill,

            getTechnicalInfo: async () => player().getTechnicalInfo(),
        }
    }, [])

    const imageCues = cues.filter(cue => cue.image)
    const picture = pictureRect(viewSize, videoSize)
    const pictureScale = zoom.scale * (zoom.fill ? coverFactor(viewSize, videoSize) : 1)

    return (
        <View
            {...viewProps}
            style={[{ backgroundColor: "#000000", overflow: "hidden" }, style]}
            onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout
                setViewSize({ width, height })
                viewProps.onLayout?.(event)
            }}
        >
            <video
                ref={videoRef}
                playsInline
                preload="auto"
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    backgroundColor: "#000000",
                    objectFit: zoom.fill ? "cover" : "contain",
                    transform: zoom.scale !== 1 ? `scale(${zoom.scale})` : undefined,
                }}
            />
            {/* What belongs to the picture (libass's canvas, PGS images) zooms with it. */}
            <div
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    transform: pictureScale !== 1 ? `scale(${pictureScale})` : undefined,
                }}
            >
                <div ref={subtitleHostRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
                {picture && imageCues.length > 0 && (
                    <div style={{ position: "absolute", ...picture }}>
                        {imageCues.map((cue, index) => <ImageSubtitle key={`${cue.start}-${index}`} image={cue.image!} video={videoSize} />)}
                    </div>
                )}
            </div>
            <SubtitleOverlay cues={cues} style={subtitleStyle} height={height} />
        </View>
    )
})
