import React from "react"
import { View } from "react-native"
import type {
    MpvPlayerViewProps,
    MpvPlayerViewRef,
    SubtitleHorizontalAlignment,
    SubtitleVerticalAlignment,
} from "./MpvPlayer.types"
import type { SubtitleCue } from "./web/subtitles"
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

function SubtitleOverlay({ cues, style, height }: { cues: SubtitleCue[]; style: SubtitleStyle; height: number }) {
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
    const [height, setHeight] = React.useState(0)
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
        })
        playerRef.current = player

        return () => {
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

    return (
        <View
            {...viewProps}
            style={[{ backgroundColor: "#000000", overflow: "hidden" }, style]}
            onLayout={(event) => {
                setHeight(event.nativeEvent.layout.height)
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
            <SubtitleOverlay cues={cues} style={subtitleStyle} height={height} />
        </View>
    )
})
