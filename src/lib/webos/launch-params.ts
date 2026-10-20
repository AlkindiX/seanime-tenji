/**
 * Parameters Tenji can be opened with on webOS, e.g.
 * `ares-launch --device tv app.seanime.tenji -p '{"mediaId":21}'`, or the
 * Application Manager's `launch` call from another app or a home automation
 * hub. They only ever open a screen; they never start playback.
 */

export type LaunchScreen = "home" | "discover"

export type LaunchRequest =
    | { kind: "media"; mediaId: number }
    | { kind: "screen"; screen: LaunchScreen }

const SCREENS: readonly LaunchScreen[] = ["home", "discover"]

function toMediaId(value: unknown): number | null {
    const id = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * The request in the parameters, or null when there is none. They arrive as
 * an object (event detail) or a JSON string (`PalmSystem.launchParams`); the
 * TV's own keys and anything else unknown are ignored. `mediaId` (an AniList
 * id) wins over `screen`.
 */
export function parseLaunchParams(raw: unknown): LaunchRequest | null {
    let params = raw
    if (typeof params === "string") {
        if (!params.trim()) return null
        try {
            params = JSON.parse(params)
        } catch {
            return null
        }
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) return null

    const record = params as Record<string, unknown>
    const mediaId = toMediaId(record.mediaId)
    if (mediaId !== null) return { kind: "media", mediaId }

    const screen = typeof record.screen === "string" ? record.screen.trim().toLowerCase() : ""
    if ((SCREENS as readonly string[]).includes(screen)) return { kind: "screen", screen: screen as LaunchScreen }
    return null
}

/** The route a request opens. */
export function launchRequestHref(request: LaunchRequest): string {
    if (request.kind === "media") return `/(app)/entry/anime/${request.mediaId}`
    return request.screen === "discover" ? "/(app)/(tabs)/discover" : "/(app)/(tabs)/(library)"
}

export type LaunchNavigation = {
    method: "push" | "dismissTo" | "navigate"
    href: string
}

/**
 * How a request is opened from the route on screen (expo-router's segments,
 * e.g. ["(app)", "(tabs)", "discover"] or ["(app)", "entry", "anime", "[id]"]).
 * A show is pushed on top of what is shown. A tab is reached with dismissTo
 * while a page (a show, a list) sits above the tabs, which closes it; with the
 * tabs on top dismissTo has nothing to pop and expo-router does nothing, so
 * the tab is switched with navigate, as the nav bar does.
 */
export function launchNavigation(request: LaunchRequest, segments: readonly string[]): LaunchNavigation {
    const href = launchRequestHref(request)
    if (request.kind === "media") return { method: "push", href }
    const pageAboveTabs = segments.length > 1 && segments[1] !== "(tabs)"
    return { method: pageAboveTabs ? "dismissTo" : "navigate", href }
}

/** Whether `pathname` (expo-router's, without groups) already shows what the request asks for. */
export function isLaunchRequestShown(request: LaunchRequest, pathname: string): boolean {
    const path = pathname.replace(/\/+$/, "") || "/"
    if (request.kind === "media") return path === `/entry/anime/${request.mediaId}`
    return request.screen === "discover" ? path === "/discover" : path === "/"
}

/** While the player is open a launch request is dropped, so it doesn't cut playback off. */
export function isPlayerPathname(pathname: string): boolean {
    return pathname === "/player" || pathname.startsWith("/player/")
}

/**
 * How long a request waits for the server. Opening a show long after the TV
 * asked for it (the server was off, the TV had no network) would surprise.
 */
export const LAUNCH_REQUEST_TTL_MS = 45_000

/** A request waiting for the server to be connected. */
export type PendingLaunch = {
    request: LaunchRequest
    /** When it arrived, on a monotonic clock (performance.now()). */
    at: number
    /** The server URL saved when it arrived; a request made for another server is dropped. */
    serverUrl: string | null
}

export type LaunchState = {
    /** The launch the app started with has been taken, so a webOSLaunch repeating it is ignored. */
    firstLaunchSeen: boolean
    pending: PendingLaunch | null
}

export const INITIAL_LAUNCH_STATE: LaunchState = { firstLaunchSeen: false, pending: null }

type Arrival = { params: unknown; at: number; serverUrl: string | null }

export type LaunchEvent =
    /** `launchParams`, read when the bundle starts: the first launch. */
    | ({ type: "start" } & Arrival)
    /** LG's webOSLaunch event, which can fire before the bundle has run, or after it with the same parameters. */
    | ({ type: "launch" } & Arrival)
    /** LG's webOSRelaunch event: launched again while running. */
    | ({ type: "relaunch" } & Arrival)
    /** That request was opened or dropped; a newer one that replaced it stays. */
    | { type: "done"; pending: PendingLaunch }

/**
 * Which launch requests are kept. The first launch is read from
 * `launchParams` at start, or from webOSLaunch when that comes first;
 * webOSLaunch repeating it afterwards is ignored. Every relaunch with a
 * request replaces the waiting one, and one without (the app's tile) leaves
 * it as it is.
 */
export function reduceLaunchState(state: LaunchState, event: LaunchEvent): LaunchState {
    if (event.type === "done") {
        return state.pending === event.pending ? { ...state, pending: null } : state
    }
    if (event.type === "launch" && state.firstLaunchSeen) return state

    const request = parseLaunchParams(event.params)
    if (!request) return state
    return {
        firstLaunchSeen: true,
        pending: { request, at: event.at, serverUrl: event.serverUrl },
    }
}

/** Whether a waiting request has waited too long, or the server it was made for has been replaced. */
export function isLaunchStale(pending: PendingLaunch, now: number, serverUrl: string | null): boolean {
    return now - pending.at >= LAUNCH_REQUEST_TTL_MS || pending.serverUrl !== serverUrl
}
