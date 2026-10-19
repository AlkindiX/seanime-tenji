/**
 * A WebSocket that Tenji's webOS JS service opens for the app (webos/service/relay.ts).
 *
 * A packaged webOS app runs from file://, so its own WebSocket handshakes carry
 * `Origin: null`, and a Seanime server without a password refuses them; a page can't
 * change that header. The service opens the socket from Node without an Origin, as the
 * native apps do, and passes frames over the Luna bus. This class gives the app the part
 * of the browser's WebSocket that the websocket provider uses.
 *
 * When the bus answers the first call with an error of its own (no such service, call
 * refused), the relay counts as missing for the rest of the session and
 * `isWebSocketRelayUsable()` turns false, so the app goes back to the browser's WebSocket.
 */
import { hasLunaBridge, lunaCall, lunaSubscribe, type LunaResponse, type LunaSubscription } from "./luna.ts"

/** webos/build.mjs packages the service as `<app id>.service`; a test checks the two agree. */
export const RELAY_SERVICE_ID = "app.seanime.tenji.service"
const SERVICE = `luna://${RELAY_SERVICE_ID}`

/** Starting the service is Node starting on the TV; a working one answers well within this. */
const ANSWER_TIMEOUT_MS = 10_000
/** How long close() waits for the server's closing handshake before reporting the socket closed. */
const CLOSE_TIMEOUT_MS = 5_000

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

let relayMissing = false

/** True on a TV unless the relay service turned out to be missing. */
export function isWebSocketRelayUsable() {
    return hasLunaBridge() && !relayMissing
}

/** For tests. */
export function resetWebSocketRelay() {
    relayMissing = false
}

export type ServerSocketEventMap = {
    open: { type: "open" }
    message: { type: "message"; data: unknown }
    error: { type: "error"; message?: unknown }
    close: { type: "close"; code: number; reason: string; wasClean: boolean }
}

/** What the websocket provider needs from a socket; the browser's WebSocket has it too. */
export type ServerSocket = {
    readonly readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    addEventListener<K extends keyof ServerSocketEventMap>(type: K, listener: (event: ServerSocketEventMap[K]) => void): void
}

type Listeners = { [K in keyof ServerSocketEventMap]: Array<(event: ServerSocketEventMap[K]) => void> }

export class LunaWebSocket implements ServerSocket {
    static readonly CONNECTING = CONNECTING
    static readonly OPEN = OPEN
    static readonly CLOSING = CLOSING
    static readonly CLOSED = CLOSED

    readonly url: string
    readyState = CONNECTING

    private socketId: string | null = null
    private subscription: LunaSubscription | null
    private timer: ReturnType<typeof setTimeout> | null = null
    private listeners: Listeners = { open: [], message: [], error: [], close: [] }

    constructor(url: string) {
        this.url = url
        this.subscription = lunaSubscribe(`${SERVICE}/connect`, { url }, response => this.handle(response))
        if (!this.subscription) {
            relayMissing = true
            // Listeners are added after the constructor returns, as with a browser WebSocket.
            setTimeout(() => this.finish(1006, "", false, "The Luna bus is not available"), 0)
            return
        }
        this.timer = setTimeout(() => this.finish(1006, "", false, "The relay service did not answer"), ANSWER_TIMEOUT_MS)
    }

    addEventListener<K extends keyof ServerSocketEventMap>(type: K, listener: (event: ServerSocketEventMap[K]) => void) {
        this.listeners[type].push(listener)
    }

    removeEventListener<K extends keyof ServerSocketEventMap>(type: K, listener: (event: ServerSocketEventMap[K]) => void) {
        const listeners = this.listeners[type] as Array<(event: ServerSocketEventMap[K]) => void>
        const index = listeners.indexOf(listener)
        if (index !== -1) listeners.splice(index, 1)
    }

    send(data: string) {
        if (this.readyState === CONNECTING) throw new Error("InvalidStateError: the WebSocket is still connecting")
        // A browser drops what is sent after close() too.
        if (this.readyState !== OPEN || !this.socketId) return
        // The relay reports a socket that went away on the subscription; nothing to do here.
        void lunaCall(`${SERVICE}/send`, { socketId: this.socketId, data }, { timeoutMs: ANSWER_TIMEOUT_MS })
    }

    close(code?: number, reason?: string) {
        if (this.readyState === CLOSING || this.readyState === CLOSED) return
        if (this.readyState === CONNECTING) {
            // As in a browser: the attempt fails with 1006. Cancelling the subscription stops the relay's socket.
            this.readyState = CLOSING
            setTimeout(() => this.finish(1006, "", false), 0)
            return
        }
        this.readyState = CLOSING
        void lunaCall(`${SERVICE}/close`, { socketId: this.socketId, code, reason }, { timeoutMs: CLOSE_TIMEOUT_MS })
        this.clearTimer()
        this.timer = setTimeout(() => this.finish(code ?? 1005, reason ?? "", false), CLOSE_TIMEOUT_MS)
    }

    private handle(response: LunaResponse) {
        if (this.readyState === CLOSED) return

        if (response.returnValue === false || (response.errorCode !== undefined && response.errorCode !== 0)) {
            const text = typeof response.errorText === "string" ? response.errorText : "Luna call failed"
            // The relay's own errors have string codes; numeric ones come from the bus.
            const fromRelay = typeof response.errorCode === "string"
            if (!fromRelay && this.socketId === null) relayMissing = true
            this.finish(1006, "", false, `${fromRelay ? "Relay" : "Luna"}: ${text}`)
            return
        }

        switch (response.event) {
            case "connecting":
                this.socketId = typeof response.socketId === "string" ? response.socketId : null
                this.clearTimer()
                break
            case "open":
                if (this.readyState !== CONNECTING) break
                this.readyState = OPEN
                this.emit("open", { type: "open" })
                break
            case "message":
                // A browser delivers no messages once close() was called.
                if (this.readyState === OPEN) this.emit("message", { type: "message", data: response.data })
                break
            case "error":
                this.emit("error", { type: "error", message: response.message })
                break
            case "close":
                this.finish(
                    typeof response.code === "number" ? response.code : 1006,
                    typeof response.reason === "string" ? response.reason : "",
                    response.wasClean === true,
                )
                break
        }
    }

    private finish(code: number, reason: string, wasClean: boolean, error?: string) {
        if (this.readyState === CLOSED) return
        this.readyState = CLOSED
        this.clearTimer()
        this.subscription?.cancel()
        this.subscription = null
        if (error) this.emit("error", { type: "error", message: error })
        this.emit("close", { type: "close", code, reason, wasClean })
    }

    private clearTimer() {
        if (!this.timer) return
        clearTimeout(this.timer)
        this.timer = null
    }

    private emit<K extends keyof ServerSocketEventMap>(type: K, event: ServerSocketEventMap[K]) {
        for (const listener of this.listeners[type].slice() as Array<(event: ServerSocketEventMap[K]) => void>) {
            try {
                listener(event)
            } catch (error) {
                // As a browser does: report it without stopping the other listeners.
                setTimeout(() => {
                    throw error
                }, 0)
            }
        }
    }
}
