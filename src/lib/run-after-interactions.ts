export type IdleTask = { cancel: () => void }

/**
 * Runs `callback` once the JS thread is idle, or after `timeout` ms at the latest.
 * Stands in for `InteractionManager.runAfterInteractions`, which React Native 0.87 removed.
 */
export function runAfterInteractions(callback: () => void, timeout = 500): IdleTask {
    if (typeof requestIdleCallback === "function") {
        const handle = requestIdleCallback(() => callback(), { timeout })
        return { cancel: () => cancelIdleCallback(handle) }
    }
    const handle = setTimeout(callback, 0)
    return { cancel: () => clearTimeout(handle) }
}
