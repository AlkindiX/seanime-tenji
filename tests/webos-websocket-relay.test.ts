import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import type { IncomingHttpHeaders } from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { isWebSocketRelayUsable, LunaWebSocket, RELAY_SERVICE_ID, resetWebSocketRelay, type ServerSocketEventMap } from "../src/lib/webos/luna-websocket.ts"
import { createRelay, redactUrl, type LunaMessage, type RelaySocketClass } from "../webos/service/relay.ts"
import { buildService, serviceIdFor } from "../webos/service-build.mjs"

const require = createRequire(import.meta.url)
// ws 7, the version the service bundles
const WS = require("ws") as RelaySocketClass & { Server: new (options: object) => any }

const g = globalThis as { window?: unknown }

async function waitFor<T>(read: () => T | null | undefined | false, what: string, timeoutMs = 3000): Promise<T> {
    const started = Date.now()
    for (;;) {
        const value = read()
        if (value) return value
        if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

/** A Seanime stand-in: greets each client, echoes what it gets, and records the handshake headers. */
async function startEchoServer() {
    const headers: IncomingHttpHeaders[] = []
    const clients: any[] = []
    const server = new WS.Server({ host: "127.0.0.1", port: 0 })
    await new Promise(resolve => server.once("listening", resolve))
    server.on("connection", (socket: any, request: http.IncomingMessage) => {
        headers.push(request.headers)
        clients.push(socket)
        socket.send("hello")
        socket.on("message", (data: unknown) => socket.send(`echo:${data}`))
    })
    return {
        url: `ws://127.0.0.1:${server.address().port}/events?id=tv&token=secret`,
        headers,
        clients,
        close: () => new Promise(resolve => server.close(resolve)),
    }
}

/** Answers every upgrade like a passwordless Seanime answers `Origin: null`. */
async function startRefusingServer() {
    const server = http.createServer()
    server.on("upgrade", (_request, socket) => {
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 9\r\n\r\nforbidden")
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as { port: number }
    return { url: `ws://127.0.0.1:${port}/events`, close: () => new Promise(resolve => server.close(resolve)) }
}

type FakeMessage = LunaMessage & { responses: Array<Record<string, unknown>> }

function lunaMessage(payload: Record<string, unknown>): FakeMessage {
    const responses: Array<Record<string, unknown>> = []
    return { payload, isSubscription: payload.subscribe === true, responses, respond: response => responses.push(response) }
}

const eventOf = (message: FakeMessage, event: string) => message.responses.find(response => response.event === event)

test("the relay opens the socket without an Origin and passes frames both ways", async () => {
    const server = await startEchoServer()
    const relay = createRelay(WS)
    try {
        const connect = lunaMessage({ url: server.url, subscribe: true })
        relay.connect(connect)
        const socketId = connect.responses[0].socketId
        assert.deepEqual(connect.responses[0], { returnValue: true, event: "connecting", socketId })
        assert.equal(typeof socketId, "string")

        await waitFor(() => eventOf(connect, "open"), "open")
        assert.equal(server.headers[0].origin, undefined)
        assert.equal(server.headers[0]["sec-websocket-origin"], undefined)
        await waitFor(() => eventOf(connect, "message"), "the greeting")
        assert.deepEqual(eventOf(connect, "message"), { returnValue: true, event: "message", data: "hello" })

        const send = lunaMessage({ socketId, data: "{\"type\":\"ping\"}" })
        relay.send(send)
        assert.deepEqual(send.responses, [{ returnValue: true }])
        await waitFor(() => connect.responses.find(response => response.data === "echo:{\"type\":\"ping\"}"), "the echo")

        const close = lunaMessage({ socketId, code: 1000, reason: "bye" })
        relay.close(close)
        assert.deepEqual(close.responses, [{ returnValue: true }])
        const closed = await waitFor(() => eventOf(connect, "close"), "close")
        assert.deepEqual(closed, { returnValue: true, event: "close", code: 1000, reason: "bye", wasClean: true })
        assert.equal(relay.openSockets(), 0)
    } finally {
        await server.close()
    }
})

test("the relay passes on the server's close code and reason", async () => {
    const server = await startEchoServer()
    const relay = createRelay(WS)
    try {
        const connect = lunaMessage({ url: server.url, subscribe: true })
        relay.connect(connect)
        await waitFor(() => eventOf(connect, "open"), "open")
        server.clients[0].close(4001, "go away")
        const closed = await waitFor(() => eventOf(connect, "close"), "close")
        assert.deepEqual(closed, { returnValue: true, event: "close", code: 4001, reason: "go away", wasClean: true })
    } finally {
        await server.close()
    }
})

test("a refused handshake ends with an error naming the status, then 1006", async () => {
    const server = await startRefusingServer()
    const relay = createRelay(WS)
    try {
        const connect = lunaMessage({ url: server.url, subscribe: true })
        relay.connect(connect)
        const closed = await waitFor(() => eventOf(connect, "close"), "close")
        assert.match(String(eventOf(connect, "error")?.message), /403/)
        assert.equal(closed.code, 1006)
        assert.equal(closed.wasClean, false)
        assert.equal(eventOf(connect, "open"), undefined)
    } finally {
        await server.close()
    }
})

test("cancelling the subscription closes the socket and stops the answers", async () => {
    const server = await startEchoServer()
    const relay = createRelay(WS)
    try {
        const connect = lunaMessage({ url: server.url, subscribe: true })
        relay.connect(connect)
        await waitFor(() => eventOf(connect, "message"), "the greeting")
        const answered = connect.responses.length
        let serverSawClose = false
        server.clients[0].on("close", () => {
            serverSawClose = true
        })
        relay.cancel(connect)
        await waitFor(() => serverSawClose, "the server to see the close")
        await waitFor(() => relay.openSockets() === 0, "the relay to drop the socket")
        assert.equal(connect.responses.length, answered)
    } finally {
        await server.close()
    }
})

test("the relay refuses bad requests with its own error codes", () => {
    const relay = createRelay(WS)
    const noSubscribe = lunaMessage({ url: "ws://127.0.0.1:1/events" })
    relay.connect(noSubscribe)
    assert.equal(noSubscribe.responses[0].returnValue, false)
    assert.equal(noSubscribe.responses[0].errorCode, "relay:subscribe")

    const badUrl = lunaMessage({ url: "http://127.0.0.1/events", subscribe: true })
    relay.connect(badUrl)
    assert.equal(badUrl.responses[0].errorCode, "relay:url")

    const send = lunaMessage({ socketId: "nope", data: "x" })
    relay.send(send)
    assert.equal(send.responses[0].errorCode, "relay:closed")

    // closing what is already gone is not an error
    const close = lunaMessage({ socketId: "nope" })
    relay.close(close)
    assert.deepEqual(close.responses, [{ returnValue: true }])
    assert.equal(relay.openSockets(), 0)
})

test("the relay keeps the password token out of its log", () => {
    assert.equal(redactUrl("ws://tv:43211/events?id=a&token=s3cret&x=1"), "ws://tv:43211/events?id=a&token=[redacted]&x=1")
    const lines: string[] = []
    const relay = createRelay(WS, { log: line => lines.push(line) })
    const connect = lunaMessage({ url: "ws://127.0.0.1:1/events?token=s3cret", subscribe: true })
    relay.connect(connect)
    relay.cancel(connect)
    assert.ok(lines.length > 0)
    assert.ok(lines.every(line => !line.includes("s3cret")))
})

///////////////////////////////////////////////////////////////////////////////
// The app's side, through a PalmServiceBridge wired to the relay
///////////////////////////////////////////////////////////////////////////////

type Relay = ReturnType<typeof createRelay>

/** Calls the relay the way the bus would: asynchronously, cancelling a subscription when the bridge is cancelled. */
function relayBridge(relay: Relay, calls: string[] = []) {
    return class {
        onservicecallback?: (message: string) => void
        message?: LunaMessage
        call(uri: string, payload: string) {
            const prefix = `luna://${RELAY_SERVICE_ID}/`
            assert.ok(uri.startsWith(prefix), uri)
            const method = uri.slice(prefix.length) as "connect" | "send" | "close"
            calls.push(method)
            const params = JSON.parse(payload) as Record<string, unknown>
            const message: LunaMessage = {
                payload: params,
                isSubscription: params.subscribe === true,
                respond: response => setTimeout(() => this.onservicecallback?.(JSON.stringify(response)), 0),
            }
            this.message = message
            setTimeout(() => relay[method](message), 0)
        }
        cancel() {
            if (this.message?.isSubscription) relay.cancel(this.message)
        }
    }
}

/** Answers every call with the same response, as the bus does for a service that isn't installed. */
function answeringBridge(response: object) {
    return class {
        onservicecallback?: (message: string) => void
        call() {
            setTimeout(() => this.onservicecallback?.(JSON.stringify(response)), 0)
        }
        cancel() {}
    }
}

function record(socket: LunaWebSocket) {
    const events: Array<{ type: string } & Record<string, unknown>> = []
    for (const type of ["open", "message", "error", "close"] as Array<keyof ServerSocketEventMap>) {
        socket.addEventListener(type, event => events.push({ ...event, readyState: socket.readyState }))
    }
    return events
}

function withBridge(Bridge: unknown, run: () => Promise<void>) {
    return async () => {
        const previous = g.window
        g.window = { PalmServiceBridge: Bridge }
        resetWebSocketRelay()
        try {
            await run()
        } finally {
            g.window = previous
            resetWebSocketRelay()
        }
    }
}

{
    const relay = createRelay(WS)
    test("LunaWebSocket behaves like a browser WebSocket over the relay", withBridge(relayBridge(relay), async () => {
        const server = await startEchoServer()
        try {
            assert.equal(isWebSocketRelayUsable(), true)
            const socket = new LunaWebSocket(server.url)
            const events = record(socket)
            assert.equal(socket.readyState, LunaWebSocket.CONNECTING)
            assert.throws(() => socket.send("too early"))

            await waitFor(() => events.find(event => event.type === "message"), "the greeting")
            assert.deepEqual(events.slice(0, 2).map(event => [event.type, event.readyState]), [["open", LunaWebSocket.OPEN], ["message", LunaWebSocket.OPEN]])
            assert.equal(events[1].data, "hello")
            assert.equal(server.headers[0].origin, undefined)

            socket.send("ping")
            await waitFor(() => events.find(event => event.data === "echo:ping"), "the echo")

            socket.close()
            assert.equal(socket.readyState, LunaWebSocket.CLOSING)
            const closed = await waitFor(() => events.find(event => event.type === "close"), "close")
            // no code given, so none comes back, as in a browser
            assert.equal(closed.code, 1005)
            assert.equal(closed.wasClean, true)
            assert.equal(socket.readyState, LunaWebSocket.CLOSED)
            await waitFor(() => relay.openSockets() === 0, "the relay to drop the socket")
            assert.equal(isWebSocketRelayUsable(), true)
        } finally {
            await server.close()
        }
    }))
}

{
    const relay = createRelay(WS)
    test("closing a LunaWebSocket while it connects fails it with 1006 and stops the relay's socket", withBridge(relayBridge(relay), async () => {
        const server = await startEchoServer()
        try {
            const socket = new LunaWebSocket(server.url)
            const events = record(socket)
            socket.close()
            const closed = await waitFor(() => events.find(event => event.type === "close"), "close")
            assert.equal(closed.code, 1006)
            assert.equal(events.some(event => event.type === "open"), false)
            await waitFor(() => relay.openSockets() === 0, "the relay to drop the socket")
        } finally {
            await server.close()
        }
    }))
}

{
    const relay = createRelay(WS)
    test("a server refusing the relay's socket is a closed socket, not a missing relay", withBridge(relayBridge(relay), async () => {
        const server = await startRefusingServer()
        try {
            const socket = new LunaWebSocket(server.url)
            const events = record(socket)
            const closed = await waitFor(() => events.find(event => event.type === "close"), "close")
            assert.equal(closed.code, 1006)
            assert.match(String(events.find(event => event.type === "error")?.message), /403/)
            assert.equal(isWebSocketRelayUsable(), true)
        } finally {
            await server.close()
        }
    }))
}

test("a missing service makes the relay unusable, so the app falls back to its own WebSocket", withBridge(
    answeringBridge({ returnValue: false, errorCode: -1, errorText: `Service does not exist: ${RELAY_SERVICE_ID}.` }),
    async () => {
        const socket = new LunaWebSocket("ws://192.168.1.20:43211/events")
        const events = record(socket)
        const closed = await waitFor(() => events.find(event => event.type === "close"), "close")
        assert.equal(closed.code, 1006)
        assert.match(String(events.find(event => event.type === "error")?.message), /Service does not exist/)
        assert.equal(isWebSocketRelayUsable(), false)
    },
))

test("an error from the relay itself keeps the relay in use", withBridge(
    answeringBridge({ returnValue: false, errorCode: "relay:url", errorText: "url must be a ws:// or wss:// URL" }),
    async () => {
        const socket = new LunaWebSocket("ws://192.168.1.20:43211/events")
        const events = record(socket)
        await waitFor(() => events.find(event => event.type === "close"), "close")
        assert.equal(isWebSocketRelayUsable(), true)
    },
))

test("without the Luna bus there is no relay", () => {
    const previous = g.window
    g.window = undefined
    try {
        assert.equal(isWebSocketRelayUsable(), false)
    } finally {
        g.window = previous
    }
})

///////////////////////////////////////////////////////////////////////////////
// The packaged service
///////////////////////////////////////////////////////////////////////////////

test("the built service registers the relay under the ID the app calls, and works", async () => {
    const appinfo = JSON.parse(fs.readFileSync(new URL("../webos/appinfo.json", import.meta.url), "utf8")) as { id: string }
    assert.equal(serviceIdFor(appinfo.id), RELAY_SERVICE_ID)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenji-service-"))
    const server = await startEchoServer()
    try {
        const outDir = path.join(dir, "service")
        const id = await buildService({ appId: appinfo.id, version: "1.2.3", outDir })
        assert.equal(id, RELAY_SERVICE_ID)
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, "services.json"), "utf8")), {
            id,
            description: "Seanime Tenji WebSocket relay",
            services: [{ name: id, description: "Seanime Tenji WebSocket relay" }],
        })
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8")), {
            name: id,
            version: "1.2.3",
            description: "Seanime Tenji WebSocket relay",
            main: "service.js",
        })

        const code = fs.readFileSync(path.join(outDir, "service.js"), "utf8")
        // Node 8 has no optional chaining, nullish coalescing or optional catch binding.
        assert.doesNotMatch(code, /\?\.[\w$[(]|\?\?|catch\s*\{/)
        assert.match(code, /require\("webos-service"\)/)

        // The TV provides webos-service; this one records what the service registers.
        const fakeService = path.join(dir, "node_modules", "webos-service")
        fs.mkdirSync(fakeService, { recursive: true })
        fs.writeFileSync(path.join(fakeService, "index.js"), [
            "module.exports = class Service {",
            "    constructor(id) { this.id = id; this.methods = {}; this.activityManager = { idleTimeout: 5 }; globalThis.__tenjiService = this }",
            "    register(name, request, cancel) { this.methods[name] = { request, cancel } }",
            "}",
        ].join("\n"))
        fs.copyFileSync(path.join(outDir, "service.js"), path.join(dir, "service.js"))
        require(path.join(dir, "service.js"))

        const service = (globalThis as { __tenjiService?: any }).__tenjiService
        assert.equal(service.id, RELAY_SERVICE_ID)
        assert.deepEqual(Object.keys(service.methods).sort(), ["close", "connect", "send"])
        assert.equal(typeof service.methods.connect.cancel, "function")
        assert.ok(service.activityManager.idleTimeout > 30)

        const connect = lunaMessage({ url: server.url, subscribe: true })
        service.methods.connect.request(connect)
        await waitFor(() => eventOf(connect, "message"), "the greeting")
        assert.equal(server.headers[0].origin, undefined)
        service.methods.connect.cancel(connect)
        await waitFor(() => server.clients[0].readyState === 3, "the server to see the close")
    } finally {
        await server.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
