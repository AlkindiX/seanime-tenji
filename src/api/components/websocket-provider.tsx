import { addClientQueryParams, getClientIdentity, saveClientIdentityFromEvent } from "@/api/client/client-identity"
import { getServerBaseUrl } from "@/api/client/server-url"
import { useWebsocketEventRouter } from "@/api/components/websocket-event-router"
import { publishWsMessage, setWsSender, type WebsocketMessage } from "@/api/components/websocket-hub"
import type { Status } from "@/api/generated/types"
import { useServerAuthToken, useServerStatus, useServerUrl, useServerUrlProtocol } from "@/atoms/server.atoms"
import { degradeServerReachability, markServerReachable } from "@/lib/connection-state"
import { manualOfflineModeAtom } from "@/lib/offline/manual-offline-mode"
import { logger } from "@/lib/utils/logger"
import { isWebSocketRelayUsable, LunaWebSocket, type ServerSocket } from "@/lib/webos/luna-websocket"
import { atom } from "jotai"
import { useAtom, useAtomValue } from "jotai/react"
import React from "react"
import { AppState, Platform } from "react-native"

const CLIENT_IDENTITY_EVENT = "client-identity"
const log = logger("websocket-provider")

export const websocketConnectedAtom = atom(false)
export const websocketConnectionStateAtom = atom<"idle" | "connecting" | "connected" | "disconnected">("idle")
/** How the last connection ended, shown on the webOS settings screen for bug reports. */
export const websocketLastCloseAtom = atom<{ code: number; reason: string } | null>(null)
/** Who opened the current connection: the app's webOS service ("relay") or the page itself. */
export const websocketTransportAtom = atom<"relay" | "browser" | null>(null)

/**
 * A Seanime server without a password refuses WebSocket handshakes from browser origins it
 * doesn't trust (403, "requires either a server password or a trusted local origin"). The webOS
 * app runs from file://, so its own handshake always carries `Origin: null` and is always refused,
 * while its HTTP requests carry no Origin and go through. The app's webOS service opens the socket
 * from Node without an Origin instead; without that service, only a server password gets it in.
 */
export function isWebsocketRefusedForOrigin(status: Status | null | undefined): boolean {
    if (Platform.OS !== "web" || !status || status.serverHasPassword) return false
    if (isWebSocketRelayUsable()) return false
    return (globalThis as { origin?: unknown }).origin === "null"
}

export const WEBSOCKET_NEEDS_PASSWORD_MESSAGE =
    "Seanime only accepts the TV app's live connection when the server has a password. Set a server password in Seanime, then sign in again on the TV."

/** On a TV, through the app's webOS service (see luna-websocket.ts) unless it turned out to be missing. */
function openServerSocket(url: string): { socket: ServerSocket; via: "relay" | "browser" } {
    if (Platform.OS === "web" && isWebSocketRelayUsable()) return { socket: new LunaWebSocket(url), via: "relay" }
    return { socket: new WebSocket(url), via: "browser" }
}

function parseMessage(data: unknown): WebsocketMessage | null {
    if (typeof data !== "string") return null

    try {
        const message = JSON.parse(data) as { type?: unknown; payload?: unknown }
        if (typeof message.type !== "string") return null
        return { type: message.type, payload: message.payload }
    }
    catch (error) {
        log.warning("Failed to parse WebSocket message", error)
        return null
    }
}

export function WebsocketProvider({ children }: { children: React.ReactNode }) {
    const serverUrl = useServerUrl()
    const serverAuthToken = useServerAuthToken()
    const serverUrlProtocol = useServerUrlProtocol()
    const manualOffline = useAtomValue(manualOfflineModeAtom)
    const [, setIsConnected] = useAtom(websocketConnectedAtom)
    const [, setConnectionState] = useAtom(websocketConnectionStateAtom)
    const [, setLastClose] = useAtom(websocketLastCloseAtom)
    const [, setTransport] = useAtom(websocketTransportAtom)
    // read on close only, so a status refresh doesn't restart the socket
    const serverStatus = useServerStatus()
    const serverStatusRef = React.useRef(serverStatus)
    serverStatusRef.current = serverStatus

    useWebsocketEventRouter()

    React.useEffect(() => {
        if (!serverUrl || manualOffline) {
            log.info("WebSocket not started", { hasServerUrl: Boolean(serverUrl), manualOffline })
            setIsConnected(false)
            setConnectionState(manualOffline ? "disconnected" : "idle")
            return
        }

        let socket: ServerSocket | null = null
        let cancelled = false
        let retryCount = 0
        let retryTimer: ReturnType<typeof setTimeout> | null = null
        let socketCount = 0

        const clearRetry = () => {
            if (!retryTimer) return
            clearTimeout(retryTimer)
            retryTimer = null
        }

        const connect = () => {
            if (cancelled || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return

            clearRetry()
            setConnectionState("connecting")

            const params = new URLSearchParams()
            addClientQueryParams(params)
            if (serverAuthToken) params.set("token", serverAuthToken)

            const scheme = serverUrlProtocol === "https:" ? "wss" : "ws"
            const url = `${scheme}://${getServerBaseUrl(serverUrl, true)}/events?${params.toString()}`
            const socketId = ++socketCount
            const startedAt = Date.now()
            let openedAt: number | null = null
            let opened: ReturnType<typeof openServerSocket>
            try {
                opened = openServerSocket(url)
            }
            catch (error) {
                // a malformed URL throws here instead of firing "error"
                log.error(`WebSocket #${socketId} could not be created`, url, error)
                setConnectionState("disconnected")
                return
            }
            const { socket: nextSocket, via } = opened
            socket = nextSocket
            log.info(`Connecting to WebSocket #${socketId}`, url, {
                attempt: retryCount + 1,
                hasToken: Boolean(serverAuthToken),
                via,
            })

            nextSocket.addEventListener("open", () => {
                if (cancelled || socket !== nextSocket) return
                openedAt = Date.now()
                log.info(`WebSocket #${socketId} opened`, { afterMs: openedAt - startedAt })
                retryCount = 0
                setWsSender(message => nextSocket.send(JSON.stringify(message)))
                setTransport(via)
                setIsConnected(true)
                setConnectionState("connected")
                markServerReachable(`websocket #${socketId} open`)
            })

            nextSocket.addEventListener("error", event => {
                // browsers give no detail here on purpose; the close code that follows says more
                const message = (event as { message?: unknown }).message
                log.warning(`WebSocket #${socketId} error`, {
                    message: typeof message === "string" ? message : null,
                    readyState: nextSocket.readyState,
                    opened: openedAt !== null,
                    afterMs: Date.now() - startedAt,
                    current: socket === nextSocket && !cancelled,
                })
            })

            nextSocket.addEventListener("message", event => {
                const message = parseMessage(event.data)
                if (!message) return

                let identityChanged = false
                if (message.type === CLIENT_IDENTITY_EVENT) {
                    const previous = getClientIdentity()
                    const saved = saveClientIdentityFromEvent(message.payload)
                    identityChanged = !!saved && saved.clientId !== previous.clientId
                }

                publishWsMessage(message)

                if (identityChanged && socket === nextSocket) {
                    log.info("Server assigned a new client ID; reconnecting WebSocket")
                    nextSocket.close()
                }
            })

            nextSocket.addEventListener("close", event => {
                const closeInfo = {
                    code: event.code,
                    reason: event.reason || null,
                    wasClean: event.wasClean,
                    opened: openedAt !== null,
                    openForMs: openedAt === null ? null : Date.now() - openedAt,
                    afterMs: Date.now() - startedAt,
                }
                if (cancelled || socket !== nextSocket) {
                    log.debug(`WebSocket #${socketId} closed (replaced or unmounted)`, closeInfo)
                    return
                }
                log.warning(`WebSocket #${socketId} closed`, { ...closeInfo, via })
                if (via === "relay" && !isWebSocketRelayUsable()) {
                    log.warning("The app's webOS service is missing; using the page's own WebSocket from now on")
                }
                else if (openedAt === null && via === "browser" && isWebsocketRefusedForOrigin(serverStatusRef.current)) {
                    log.warning("The server refuses this app's WebSocket: it has no password and the page's origin is null")
                }
                setLastClose({ code: event.code, reason: event.reason })

                socket = null
                setWsSender(null)
                setTransport(null)
                setIsConnected(false)
                setConnectionState("disconnected")
                degradeServerReachability(`websocket #${socketId} closed (code ${event.code})`)

                retryCount += 1
                const delay = retryCount === 1 ? 0 : Math.min(1500 * Math.pow(2, retryCount - 2), 30_000)
                log.info(`Reconnecting in ${delay}ms (attempt ${retryCount})`)
                retryTimer = setTimeout(connect, delay)
            })
        }

        const appStateSub = AppState.addEventListener("change", state => {
            if (state !== "active") return
            log.info("App active; WebSocket readyState", socket?.readyState ?? "none")
            if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
                retryCount = 0
                connect()
            }
        })

        log.info("WebSocket effect started", {
            protocol: serverUrlProtocol,
            hasToken: Boolean(serverAuthToken),
        })
        connect()

        return () => {
            log.info("WebSocket effect stopped (server, token or offline mode changed)")
            cancelled = true
            clearRetry()
            appStateSub.remove()
            setWsSender(null)
            socket?.close()
        }
    }, [manualOffline, serverAuthToken, serverUrl, serverUrlProtocol, setConnectionState, setIsConnected, setLastClose, setTransport])

    return children
}
