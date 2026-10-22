export type WebsocketMessage = Readonly<{
    type: string
    payload?: unknown
}>

export type WebsocketMessageListener = (message: WebsocketMessage) => void | Promise<void>

const listeners = new Set<WebsocketMessageListener>()
let sender: ((message: WebsocketMessage) => void) | null = null

/** The provider registers the open socket here (null when it closes). */
export function setWsSender(next: ((message: WebsocketMessage) => void) | null) {
    sender = next
}

/** Sends a message to the server; false when no socket is open. */
export function sendWsMessage(message: WebsocketMessage): boolean {
    if (!sender) return false
    try {
        sender(message)
        return true
    }
    catch (error) {
        console.warn("WebSocket send failed", error)
        return false
    }
}

export function subscribeWsMessage(listener: WebsocketMessageListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function publishWsMessage(message: WebsocketMessage) {
    for (const listener of listeners) {
        try {
            Promise.resolve(listener(message)).catch(error => {
                console.warn("WebSocket listener failed", error)
            })
        }
        catch (error) {
            console.warn("WebSocket listener failed", error)
        }
    }
}

type WebsocketSender = (message: WebsocketMessage) => void

let sender: WebsocketSender | null = null

/** Set by the WebSocket provider while its socket is open. */
export function setWsSender(next: WebsocketSender | null) {
    sender = next
}

/** Sends a message to the server; false when the socket is not open. */
export function sendWsMessage(message: WebsocketMessage): boolean {
    if (!sender) return false
    sender(message)
    return true
}
