/**
 * The WebSocket relay in Tenji's webOS JS service (`<app id>.service`, see service.ts).
 *
 * A packaged webOS app runs from file://, so the handshakes of its own WebSockets carry
 * `Origin: null`, which a Seanime server without a password refuses. The service runs in Node,
 * whose WebSocket client sends no Origin, the same as the native apps, and passes frames between
 * the server and the app over the Luna bus:
 *
 *   connect {url, subscribe: true}    → {event: "connecting", socketId}, then on the same subscription
 *                                       {event: "open"}, {event: "message", data},
 *                                       {event: "error", message}, {event: "close", code, reason, wasClean}
 *   send {socketId, data}             → {returnValue: true}
 *   close {socketId, code?, reason?}  → {returnValue: true}; the close event follows on the subscription
 *
 * Cancelling the connect subscription (the app shutting the socket, or the app exiting) closes the
 * socket. The relay's own failures carry a string `errorCode` ("relay:…"), so the app can tell
 * them apart from the bus's numeric ones, such as a missing service.
 */

/** The part of webos-service's Message the relay uses. */
export type LunaMessage = {
    payload: Record<string, unknown>
    isSubscription?: boolean
    respond: (response: Record<string, unknown>) => unknown
}

/** The part of the `ws` client the relay uses. ws 7 hands text frames over as strings, ws 8 as Buffers with an isBinary flag. */
export type RelaySocket = {
    readonly readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    terminate(): void
    on(event: "open", listener: () => void): unknown
    on(event: "message", listener: (data: unknown, isBinary?: boolean) => void): unknown
    on(event: "error", listener: (error: unknown) => void): unknown
    on(event: "close", listener: (code: number, reason: unknown) => void): unknown
}

export type RelaySocketClass = new (url: string, options: Record<string, unknown>) => RelaySocket

const CONNECTING = 0
const OPEN = 1

/** The app keeps one socket; anything past this is a leak, so the oldest goes. */
const MAX_SOCKETS = 4

type Entry = {
    id: string
    socket: RelaySocket
    message: LunaMessage
    cancelled: boolean
    closed: boolean
}

function errorText(error: unknown) {
    if (error instanceof Error) return error.message
    return String(error)
}

/** Server URLs carry the password token as a query parameter. */
export function redactUrl(url: string) {
    return url.replace(/([?&]token=)[^&#]*/gi, "$1[redacted]")
}

function textFrame(data: unknown, isBinary?: boolean): string | null {
    if (typeof data === "string") return data
    if (isBinary === false && data && typeof (data as { toString?: unknown }).toString === "function") {
        return (data as { toString: (encoding: string) => string }).toString("utf8")
    }
    return null
}

export function createRelay(Socket: RelaySocketClass, { log = () => {} }: { log?: (line: string) => void } = {}) {
    const sockets = new Map<string, Entry>()
    let count = 0

    const fail = (message: LunaMessage, errorCode: string, error: string) => {
        message.respond({ returnValue: false, errorCode: `relay:${errorCode}`, errorText: error })
    }

    const emit = (entry: Entry, payload: Record<string, unknown>) => {
        if (entry.cancelled) return
        try {
            entry.message.respond({ returnValue: true, ...payload })
        } catch (error) {
            log(`socket ${entry.id}: could not answer the app: ${errorText(error)}`)
        }
    }

    const shut = (entry: Entry, code?: number, reason?: string) => {
        if (entry.socket.readyState === CONNECTING) {
            entry.socket.terminate()
            return
        }
        try {
            entry.socket.close(code, reason)
        } catch {
            // ws only takes 1000 and 3000–4999
            entry.socket.close()
        }
    }

    const find = (socketId: unknown) => typeof socketId === "string" ? sockets.get(socketId) : undefined

    function connect(message: LunaMessage) {
        const url = message.payload.url
        if (!message.isSubscription) return fail(message, "subscribe", "connect needs subscribe: true")
        if (typeof url !== "string" || !/^wss?:\/\//i.test(url)) return fail(message, "url", "url must be a ws:// or wss:// URL")

        let socket: RelaySocket
        try {
            // No `origin` option, so the handshake has no Origin header, like the native apps'.
            socket = new Socket(url, { perMessageDeflate: false, handshakeTimeout: 20_000 })
        }
        catch (error) {
            return fail(message, "url", errorText(error))
        }

        const entry: Entry = { id: `${Date.now().toString(36)}.${++count}`, socket, message, cancelled: false, closed: false }
        sockets.set(entry.id, entry)
        log(`socket ${entry.id}: connecting to ${redactUrl(url)}`)
        emit(entry, { event: "connecting", socketId: entry.id })

        socket.on("open", () => {
            log(`socket ${entry.id}: open`)
            emit(entry, { event: "open" })
        })
        socket.on("message", (data, isBinary) => {
            const text = textFrame(data, isBinary)
            // Seanime only sends JSON text; a browser would hand a binary frame over as a Blob the app ignores.
            if (text !== null) emit(entry, { event: "message", data: text })
        })
        socket.on("error", (error) => {
            log(`socket ${entry.id}: ${errorText(error)}`)
            emit(entry, { event: "error", message: errorText(error) })
        })
        socket.on("close", (code, reason) => {
            sockets.delete(entry.id)
            if (entry.closed) return
            entry.closed = true
            const reasonText = reason === undefined || reason === null ? "" : String(reason)
            log(`socket ${entry.id}: closed with ${code}${entry.cancelled ? " (cancelled by the app)" : ""}`)
            // ws reports 1006 when the connection dropped without a closing handshake.
            emit(entry, { event: "close", code, reason: reasonText, wasClean: code !== 1006 })
        })

        if (sockets.size > MAX_SOCKETS) {
            const oldest = sockets.values().next().value
            if (oldest && oldest !== entry) {
                log(`socket ${oldest.id}: closed to make room`)
                shut(oldest, 1000, "Too many sockets")
            }
        }
    }

    function send(message: LunaMessage) {
        const entry = find(message.payload.socketId)
        const data = message.payload.data
        if (!entry || entry.closed) return fail(message, "closed", "No such socket, or it has closed")
        if (typeof data !== "string") return fail(message, "data", "data must be a string")
        if (entry.socket.readyState !== OPEN) return fail(message, "not-open", "The socket is not open")
        try {
            entry.socket.send(data)
        }
        catch (error) {
            return fail(message, "send", errorText(error))
        }
        message.respond({ returnValue: true })
    }

    function close(message: LunaMessage) {
        const entry = find(message.payload.socketId)
        if (entry && !entry.closed) {
            const { code, reason } = message.payload
            shut(entry, typeof code === "number" ? code : undefined, typeof reason === "string" ? reason : undefined)
        }
        message.respond({ returnValue: true })
    }

    /** The app cancelled a connect subscription, or the bus did because the app went away. */
    function cancel(message: LunaMessage) {
        for (const entry of sockets.values()) {
            if (entry.message !== message) continue
            entry.cancelled = true
            if (!entry.closed) shut(entry, 1000)
        }
    }

    return { connect, send, close, cancel, openSockets: () => sockets.size }
}
