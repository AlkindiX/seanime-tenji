import { createScrubController, type ScrubController, type ScrubSnapshot } from "@/lib/player/scrub"
import * as React from "react"

type Options = {
    time: number
    duration: number
    /** The press step in seconds. */
    step: number
    seekTo: (seconds: number) => void
    seekRelative: (seconds: number) => void
    /** Called whenever the target moves. */
    onActivity?: () => void
}

/**
 * The player's scrubbing controller (src/lib/player/scrub.ts). It is made
 * once and reads the latest options when used, so the player screen doesn't
 * re-render while the target moves; the controls follow it through
 * `useScrubSnapshot`.
 */
export function useTVScrub(options: Options): ScrubController {
    const latest = React.useRef(options)
    latest.current = options

    const [scrub] = React.useState(() => createScrubController({
        getTime: () => latest.current.time,
        getDuration: () => latest.current.duration,
        getStep: () => latest.current.step,
        seekTo: seconds => latest.current.seekTo(seconds),
        seekRelative: seconds => latest.current.seekRelative(seconds),
        onActivity: () => latest.current.onActivity?.(),
    }))

    React.useEffect(() => {
        scrub.observeTime(options.time)
    }, [scrub, options.time])

    React.useEffect(() => () => scrub.reset(), [scrub])

    return scrub
}

const subscribeNone = () => () => {}
const snapshotNone = () => null

/** The pending (or just committed) seek target; null without a controller. */
export function useScrubSnapshot(scrub: ScrubController | undefined): ScrubSnapshot | null {
    const subscribe = scrub?.subscribe ?? subscribeNone
    const getSnapshot = scrub?.getSnapshot ?? snapshotNone
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
