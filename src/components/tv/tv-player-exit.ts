import type * as React from "react"
import { Platform, type View } from "react-native"

/**
 * The player's exit on webOS: a short fade and shrink with the Web
 * Animations API, on opacity and transform only, which the TV composites
 * without JavaScript per frame (see tv-screen-transition.tsx). The page
 * underneath then eases in as on any Back.
 */

const EXIT_MS = 160
/** Accelerates away, as a screen that leaves. */
const EASING = "cubic-bezier(0.4, 0, 1, 1)"
/** `onfinish` needs frames, which a hidden page doesn't get; don't wait past this. */
const EXIT_TIMEOUT_MS = EXIT_MS + 80

/** Resolves when the view has faded out (at once off webOS, or without the API). */
export function playPlayerExit(view: React.ComponentRef<typeof View> | null): Promise<void> {
    const node = view as unknown as HTMLElement | null
    if (Platform.OS !== "web" || !node || typeof node.animate !== "function") return Promise.resolve()

    return new Promise((resolve) => {
        let done = false
        const finish = () => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve()
        }
        const timer = setTimeout(finish, EXIT_TIMEOUT_MS)
        try {
            // `finished` (a promise) came in Chromium 84; webOS 6 has 79.
            const animation = node.animate([
                { opacity: 1, transform: "scale(1)" },
                { opacity: 0, transform: "scale(0.96)" },
            ], { duration: EXIT_MS, easing: EASING, fill: "forwards" })
            animation.onfinish = finish
        } catch {
            finish()
        }
    })
}
