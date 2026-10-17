/**
 * One-shot Luna service calls through `PalmServiceBridge`, the object LG's
 * webOSTV.js builds `webOS.service.request` on. This is the part of that
 * library the app needs, without loading it.
 *
 * On webOS TV 26 and later, a Luna call is refused unless appinfo.json lists
 * the service's access control group in `requiredACG`.
 */

type ServiceBridge = {
    onservicecallback?: (message: string) => void
    call: (uri: string, payload: string) => void
    cancel?: () => void
}

type BridgeWindow = {
    PalmServiceBridge?: new () => ServiceBridge
}

export type LunaResponse = Record<string, unknown> & { returnValue?: boolean }

// The bridge is collected (and its callback never fires) if nothing holds it.
const inFlight = new Set<ServiceBridge>()

export function hasLunaBridge() {
    if (typeof window === "undefined") return false
    return typeof (window as BridgeWindow).PalmServiceBridge === "function"
}

/**
 * Calls `uri` (e.g. `luna://com.webos.service.config/getConfigs`) once.
 * Resolves `null` outside a TV, on a failure response (`returnValue: false`
 * or an `errorCode`, which is what a refused ACG returns) and after
 * `timeoutMs` without an answer, so callers treat every one as "unknown".
 */
export function lunaCall(uri: string, params: Record<string, unknown> = {}, { timeoutMs = 3000 } = {}): Promise<LunaResponse | null> {
    if (!hasLunaBridge()) return Promise.resolve(null)
    const Bridge = (window as BridgeWindow).PalmServiceBridge!

    return new Promise((resolve) => {
        let bridge: ServiceBridge | null = null
        let settled = false

        const finish = (value: LunaResponse | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (bridge) {
                inFlight.delete(bridge)
                try {
                    bridge.cancel?.()
                } catch {
                    // Already closed by the service.
                }
            }
            resolve(value)
        }
        const timer = setTimeout(() => finish(null), timeoutMs)

        try {
            bridge = new Bridge()
            inFlight.add(bridge)
            bridge.onservicecallback = (message) => {
                let response: LunaResponse | null = null
                try {
                    response = JSON.parse(message) as LunaResponse
                } catch {
                    finish(null)
                    return
                }
                const failed = !response || typeof response !== "object" || response.returnValue === false || !!response.errorCode
                finish(failed ? null : response)
            }
            bridge.call(uri, JSON.stringify(params))
        } catch {
            finish(null)
        }
    })
}
