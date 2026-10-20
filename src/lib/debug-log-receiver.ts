import { getStoredString, removeStoredKey, setStoredString } from "@/atoms/storage"
import Constants from "expo-constants"
import { Platform } from "react-native"

/**
 * Streams log entries to `tools/debug-log-receiver.mjs` running on a computer on the
 * same network, for devices with no way to copy logs off them (TVs). Entries reach it
 * already redacted. Uses its own `fetch` and never logs through the logger, so a
 * receiver that is down can't feed itself more entries.
 */

const RECEIVER_URL_STORAGE_KEY = "sea-debug-log-receiver-url"
export const DEFAULT_RECEIVER_PORT = 8787
const FLUSH_DELAY_MS = 1000
const RETRY_DELAY_MS = 5000
const MAX_QUEUED_ENTRIES = 1000
const MAX_ENTRIES_PER_REQUEST = 250
const REQUEST_TIMEOUT_MS = 8000

export type ReceiverSendResult = { ok: true, sent: number } | { ok: false, error: string }

let queue: unknown[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false
let lastError: string | null = null

/** Accepts `192.168.1.20`, `192.168.1.20:8787` or a full `http://` URL. */
export function normalizeReceiverUrl(input: string): string | null {
    let value = input.trim()
    if (!value) return null
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`

    try {
        const url = new URL(value)
        if (!url.hostname) return null
        if (!url.port && !/^https?:\/\/[^/]+:\d+/i.test(value)) url.port = String(DEFAULT_RECEIVER_PORT)
        return `${url.protocol}//${url.host}`
    }
    catch {
        return null
    }
}

export function getDebugLogReceiverUrl(): string | null {
    return getStoredString(RECEIVER_URL_STORAGE_KEY)
}

export function setDebugLogReceiverUrl(url: string | null) {
    queue = []
    lastError = null
    if (url) setStoredString(RECEIVER_URL_STORAGE_KEY, url)
    else removeStoredKey(RECEIVER_URL_STORAGE_KEY)
}

export function getDebugLogReceiverLastError(): string | null {
    return lastError
}

export function describeLogDevice() {
    const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator
    return {
        platform: Platform.OS,
        isTV: Boolean(Platform.isTV),
        appVersion: Constants.expoConfig?.version ?? null,
        userAgent: Platform.OS === "web" ? nav?.userAgent ?? null : null,
    }
}

async function post(url: string, entries: unknown[]): Promise<ReceiverSendResult> {
    const controller = typeof AbortController === "function" ? new AbortController() : null
    const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS)

    try {
        // text/plain keeps this a "simple" request, so the browser (webOS) sends no
        // CORS preflight from the app's file:// origin
        const response = await fetch(`${url}/logs`, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ device: describeLogDevice(), entries }),
            signal: controller?.signal,
        })
        if (!response.ok) return { ok: false, error: `Receiver answered ${response.status}` }
        return { ok: true, sent: entries.length }
    }
    catch (error) {
        const timedOut = error instanceof Error && error.name === "AbortError"
        return { ok: false, error: timedOut ? "Receiver did not answer" : String((error as Error)?.message ?? error) }
    }
    finally {
        clearTimeout(timeout)
    }
}

function scheduleFlush(delay: number) {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
        flushTimer = null
        void flush()
    }, delay)
}

async function flush() {
    const url = getDebugLogReceiverUrl()
    if (!url || flushing || queue.length === 0) return

    flushing = true
    const batch = queue.slice(0, MAX_ENTRIES_PER_REQUEST)
    const result = await post(url, batch)
    flushing = false

    if (getDebugLogReceiverUrl() !== url) return

    if (result.ok) {
        lastError = null
        queue = queue.slice(batch.length)
        if (queue.length > 0) scheduleFlush(0)
        return
    }

    lastError = result.error
    scheduleFlush(RETRY_DELAY_MS)
}

/** Queues one already-redacted entry; sent within a second while a receiver is set. */
export function queueForDebugLogReceiver(entry: unknown) {
    if (!getDebugLogReceiverUrl()) return

    queue.push(entry)
    if (queue.length > MAX_QUEUED_ENTRIES) queue = queue.slice(queue.length - MAX_QUEUED_ENTRIES)
    scheduleFlush(FLUSH_DELAY_MS)
}

/** Sends `entries` (already redacted) in batches, for "send saved logs". */
export async function sendToDebugLogReceiver(entries: unknown[], url = getDebugLogReceiverUrl()): Promise<ReceiverSendResult> {
    if (!url) return { ok: false, error: "No log receiver set" }

    let sent = 0
    for (let i = 0; i < entries.length || i === 0; i += MAX_ENTRIES_PER_REQUEST) {
        const result = await post(url, entries.slice(i, i + MAX_ENTRIES_PER_REQUEST))
        if (!result.ok) {
            lastError = result.error
            return result
        }
        sent += result.sent
    }

    lastError = null
    return { ok: true, sent }
}
