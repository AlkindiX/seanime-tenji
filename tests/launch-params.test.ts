import assert from "node:assert/strict"
import test from "node:test"
import {
    INITIAL_LAUNCH_STATE,
    isLaunchRequestShown,
    isLaunchStale,
    isPlayerPathname,
    LAUNCH_REQUEST_TTL_MS,
    type LaunchEvent,
    launchNavigation,
    launchRequestHref,
    type LaunchState,
    parseLaunchParams,
    reduceLaunchState,
} from "../src/lib/webos/launch-params.ts"
import { findLaunchParams } from "../src/lib/webos/webos-platform.ts"

test("a mediaId opens that show, as an object or a JSON string", () => {
    assert.deepEqual(parseLaunchParams({ mediaId: 21 }), { kind: "media", mediaId: 21 })
    assert.deepEqual(parseLaunchParams("{\"mediaId\":21}"), { kind: "media", mediaId: 21 })
    assert.deepEqual(parseLaunchParams({ mediaId: " 154587 " }), { kind: "media", mediaId: 154587 })
})

test("mediaId wins over screen", () => {
    assert.deepEqual(parseLaunchParams({ mediaId: 1, screen: "discover" }), { kind: "media", mediaId: 1 })
})

test("screen opens the start screen or Discover", () => {
    assert.deepEqual(parseLaunchParams({ screen: "home" }), { kind: "screen", screen: "home" })
    assert.deepEqual(parseLaunchParams("{\"screen\":\"Discover\"}"), { kind: "screen", screen: "discover" })
})

test("anything else is not a request", () => {
    for (const raw of [
        undefined,
        null,
        "",
        "  ",
        "{}",
        "not json",
        "[1]",
        42,
        [],
        {},
        { mediaId: 0 },
        { mediaId: -3 },
        { mediaId: 1.5 },
        { mediaId: "12abc" },
        { mediaId: Number.MAX_SAFE_INTEGER + 2 },
        { screen: "player" },
        { displayAffinity: 0 },
    ]) {
        assert.equal(parseLaunchParams(raw), null, JSON.stringify(raw))
    }
})

test("requests map to routes", () => {
    assert.equal(launchRequestHref({ kind: "media", mediaId: 21 }), "/(app)/entry/anime/21")
    assert.equal(launchRequestHref({ kind: "screen", screen: "home" }), "/(app)/(tabs)/(library)")
    assert.equal(launchRequestHref({ kind: "screen", screen: "discover" }), "/(app)/(tabs)/discover")
})

test("a show is pushed on top of whatever is shown", () => {
    const request = { kind: "media", mediaId: 21 } as const
    assert.deepEqual(launchNavigation(request, ["(app)", "(tabs)", "(library)"]), { method: "push", href: "/(app)/entry/anime/21" })
    assert.deepEqual(launchNavigation(request, ["(app)", "entry", "anime", "[id]"]), { method: "push", href: "/(app)/entry/anime/21" })
})

test("a tab is switched to with navigate when the tabs are on top", () => {
    assert.deepEqual(launchNavigation({ kind: "screen", screen: "discover" }, ["(app)", "(tabs)", "(library)"]),
        { method: "navigate", href: "/(app)/(tabs)/discover" })
    assert.deepEqual(launchNavigation({ kind: "screen", screen: "home" }, ["(app)", "(tabs)", "discover", "search"]),
        { method: "navigate", href: "/(app)/(tabs)/(library)" })
    // Before the router has a route there is nothing to dismiss either.
    assert.equal(launchNavigation({ kind: "screen", screen: "home" }, []).method, "navigate")
})

test("a tab is reached with dismissTo when a page sits above the tabs", () => {
    assert.deepEqual(launchNavigation({ kind: "screen", screen: "home" }, ["(app)", "entry", "anime", "[id]"]),
        { method: "dismissTo", href: "/(app)/(tabs)/(library)" })
    assert.deepEqual(launchNavigation({ kind: "screen", screen: "discover" }, ["(app)", "(media)", "media-list"]),
        { method: "dismissTo", href: "/(app)/(tabs)/discover" })
})

test("a request for the screen already shown does nothing", () => {
    assert.equal(isLaunchRequestShown({ kind: "media", mediaId: 21 }, "/entry/anime/21"), true)
    assert.equal(isLaunchRequestShown({ kind: "media", mediaId: 21 }, "/entry/anime/210"), false)
    assert.equal(isLaunchRequestShown({ kind: "screen", screen: "home" }, "/"), true)
    assert.equal(isLaunchRequestShown({ kind: "screen", screen: "home" }, "/discover"), false)
    assert.equal(isLaunchRequestShown({ kind: "screen", screen: "discover" }, "/discover/"), true)
})

test("the player path is recognised", () => {
    assert.equal(isPlayerPathname("/player"), true)
    assert.equal(isPlayerPathname("/players"), false)
    assert.equal(isPlayerPathname("/entry/anime/1"), false)
})

test("launch parameters are read from webOSSystem, then PalmSystem", () => {
    assert.equal(findLaunchParams({ webOSSystem: { launchParams: "{\"mediaId\":1}" } }), "{\"mediaId\":1}")
    assert.equal(findLaunchParams({ webOSSystem: { launchParams: "" }, PalmSystem: { launchParams: "{\"screen\":\"home\"}" } }),
        "{\"screen\":\"home\"}")
    assert.equal(findLaunchParams({ webOSSystem: {}, PalmSystem: {} }), undefined)
    assert.equal(findLaunchParams({}), undefined)
})

const SERVER = "http://192.0.2.1:43211"

function arrive(type: "start" | "launch" | "relaunch", params: unknown, at = 0, serverUrl: string | null = SERVER): LaunchEvent {
    return { type, params, at, serverUrl }
}

function run(events: LaunchEvent[], start: LaunchState = INITIAL_LAUNCH_STATE): LaunchState {
    return events.reduce(reduceLaunchState, start)
}

test("the first launch is read from launchParams, and webOSLaunch repeating it is ignored", () => {
    const state = run([
        arrive("start", "{\"mediaId\":21}", 5),
        arrive("launch", { mediaId: 21 }, 40),
    ])
    assert.deepEqual(state.pending, { request: { kind: "media", mediaId: 21 }, at: 5, serverUrl: SERVER })
    assert.equal(state.firstLaunchSeen, true)
})

test("webOSLaunch brings the first launch when launchParams held none", () => {
    const state = run([
        arrive("start", undefined, 5),
        arrive("launch", { screen: "discover" }, 40),
    ])
    assert.deepEqual(state.pending?.request, { kind: "screen", screen: "discover" })
    assert.equal(state.pending?.at, 40)
    // ...and only the first webOSLaunch.
    assert.deepEqual(reduceLaunchState(state, arrive("launch", { mediaId: 3 }, 50)), state)
})

test("every relaunch with a request is taken; one without leaves the waiting request", () => {
    let state = run([arrive("start", { mediaId: 1 }, 0)])
    state = reduceLaunchState(state, arrive("relaunch", { mediaId: 2 }, 10))
    assert.deepEqual(state.pending?.request, { kind: "media", mediaId: 2 })
    state = reduceLaunchState(state, arrive("relaunch", { screen: "home" }, 20))
    assert.deepEqual(state.pending?.request, { kind: "screen", screen: "home" })

    // The app's tile relaunches it without parameters.
    const unchanged = reduceLaunchState(state, arrive("relaunch", "", 30))
    assert.equal(unchanged, state)
    assert.equal(reduceLaunchState(state, arrive("relaunch", { displayAffinity: 0 }, 30)), state)
})

test("a relaunch is taken even before any launch was seen", () => {
    const state = run([arrive("relaunch", { mediaId: 9 }, 7)])
    assert.deepEqual(state.pending?.request, { kind: "media", mediaId: 9 })
    assert.equal(state.firstLaunchSeen, true)
})

test("done clears only the request it was given", () => {
    const first = run([arrive("start", { mediaId: 1 }, 0)])
    const opened = first.pending!
    assert.equal(reduceLaunchState(first, { type: "done", pending: opened }).pending, null)

    // A relaunch replaced it while it was being opened: the new one stays.
    const replaced = reduceLaunchState(first, arrive("relaunch", { mediaId: 2 }, 10))
    assert.equal(reduceLaunchState(replaced, { type: "done", pending: opened }), replaced)
})

test("a waiting request expires, and is dropped when the server changes", () => {
    const pending = run([arrive("start", { mediaId: 1 }, 1000)]).pending!
    assert.equal(isLaunchStale(pending, 1000, SERVER), false)
    assert.equal(isLaunchStale(pending, 1000 + LAUNCH_REQUEST_TTL_MS - 1, SERVER), false)
    assert.equal(isLaunchStale(pending, 1000 + LAUNCH_REQUEST_TTL_MS, SERVER), true)
    assert.equal(isLaunchStale(pending, 1000, "http://192.0.2.2:43211"), true)
    assert.equal(isLaunchStale(pending, 1000, null), true)

    // Made before any server was set: setting one up counts as a change.
    const early = run([arrive("start", { mediaId: 1 }, 0, null)]).pending!
    assert.equal(isLaunchStale(early, 0, SERVER), true)
})
