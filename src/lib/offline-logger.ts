import { getStoredJsonValue, getStoredString, removeStoredKey, setStoredString } from "@/atoms/storage"
import { describeLogDevice, queueForDebugLogReceiver } from "@/lib/debug-log-receiver"
import { ExpoOfflineLogger } from "expo-offline-logger"
import { AppState, Platform } from "react-native"

export type OfflineLogLevel = "debug" | "info" | "success" | "warning" | "error" | "fatal"

export type OfflineLogEntry = {
    id: string
    timestamp: string
    level: OfflineLogLevel
    scope: string
    message: string
    data: string[]
    platform: string
    native?: boolean
}

type ConsoleMethod = "debug" | "info" | "log" | "warn" | "error"
type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void
type ErrorUtilsLike = {
    getGlobalHandler?: () => GlobalErrorHandler
    setGlobalHandler?: (handler: GlobalErrorHandler) => void
}
type RejectionEventLike = {
    reason?: unknown
}
type GlobalWithErrorHooks = typeof globalThis & {
    ErrorUtils?: ErrorUtilsLike
    addEventListener?: (eventName: string, listener: (event: RejectionEventLike) => void) => void
    onunhandledrejection?: ((event: RejectionEventLike) => void) | null
}

const OFFLINE_LOGS_STORAGE_KEY = "sea-offline-log-entries"
const OFFLINE_LOGGING_ENABLED_STORAGE_KEY = "sea-offline-logging-enabled"
const MAX_OFFLINE_LOG_ENTRIES = 1500
const PERSIST_DELAY_MS = 750
const MAX_DATA_ITEMS_PER_ENTRY = 5
const MAX_DATA_ITEM_LENGTH = 500

const originalConsole = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
} satisfies Record<ConsoleMethod, (...data: unknown[]) => void>

let installed = false
let consolePatched = false
// entries live in memory and are written out shortly after the last append, so
// debug logging doesn't re-serialize the whole log on every line
let cachedEntries: OfflineLogEntry[] | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

function consoleMethodForLevel(level: OfflineLogLevel): ConsoleMethod {
    if (level === "debug") return "debug"
    if (level === "warning") return "warn"
    if (level === "error" || level === "fatal") return "error"
    return "log"
}

function levelForConsoleMethod(method: ConsoleMethod): OfflineLogLevel {
    if (method === "debug") return "debug"
    if (method === "warn") return "warning"
    if (method === "error") return "error"
    return "info"
}

function stringifyValue(value: unknown, seen = new WeakSet<object>()): string {
    if (value instanceof Error) {
        return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`
    }

    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value)
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol()"
    if (typeof value === "function") return `[function ${value.name || "anonymous"}]`

    try {
        return JSON.stringify(value, (_key, nestedValue: unknown) => {
            if (typeof nestedValue === "bigint") return nestedValue.toString()
            if (typeof nestedValue === "function") return `[function ${nestedValue.name || "anonymous"}]`
            if (typeof nestedValue === "symbol") return nestedValue.description ? `Symbol(${nestedValue.description})` : "Symbol()"
            if (nestedValue instanceof Error) {
                return {
                    name: nestedValue.name,
                    message: nestedValue.message,
                    stack: nestedValue.stack,
                }
            }
            if (nestedValue && typeof nestedValue === "object") {
                if (seen.has(nestedValue)) return "[circular]"
                seen.add(nestedValue)
            }
            return nestedValue
        }) ?? String(value)
    }
    catch {
        return String(value)
    }
}

function redactSensitiveText(value: string): string {
    return value
        .replace(/([?&](?:token|proof|auth|authorization|access_token|refresh_token|api_key|apikey)=)[^&\s"]+/gi, `$1[redacted]`)
        .replace(/("(?:token|proof|auth|authorization|accessToken|refreshToken|apiKey|api_key)"\s*:\s*")[^"]+"/gi, `$1[redacted]"`)
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
        .replace(/\/Users\/.+?\/seanime-tenji\//g, "[sea]/")
        .replace(/\/home\/.+?\/seanime-tenji\//g, "[sea]/")
        .replace(/\/Users\/[A-Za-z0-9_-]+\//g, "/[sailor]/")
        .replace(/\/home\/[A-Za-z0-9_-]+\//g, "/[sailor]/")
}

function sanitizeEntryForExport(entry: OfflineLogEntry): OfflineLogEntry {
    return {
        ...entry,
        message: redactSensitiveText(entry.message),
        data: entry.data.map(item => redactSensitiveText(item)),
    }
}

function createOfflineLogEntry(level: OfflineLogLevel, scope: string, data: unknown[], native = false): OfflineLogEntry {
    const normalizedData = data
        .slice(0, MAX_DATA_ITEMS_PER_ENTRY)
        .map(item => stringifyValue(item).slice(0, MAX_DATA_ITEM_LENGTH))
    const timestamp = new Date().toISOString()

    return {
        id: `${timestamp}-${Math.random().toString(36).slice(2)}`,
        timestamp,
        level,
        scope,
        message: normalizedData.join(" ").slice(0, 800),
        data: normalizedData,
        platform: Platform.OS,
        native,
    }
}

function loadEntries(): OfflineLogEntry[] {
    if (!cachedEntries) {
        cachedEntries = getStoredJsonValue<OfflineLogEntry[]>(OFFLINE_LOGS_STORAGE_KEY) ?? []
    }
    return cachedEntries
}

function writeEntries() {
    if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
    }
    if (!cachedEntries) return

    try {
        setStoredString(OFFLINE_LOGS_STORAGE_KEY, JSON.stringify(cachedEntries))
    }
    catch {
        cachedEntries = cachedEntries.slice(-50)
        try {
            setStoredString(OFFLINE_LOGS_STORAGE_KEY, JSON.stringify(cachedEntries))
        }
        catch {
            removeStoredKey(OFFLINE_LOGS_STORAGE_KEY)
        }
    }
}

function persistEntry(entry: OfflineLogEntry) {
    try {
        const entries = loadEntries()
        entries.push(entry)
        if (entries.length > MAX_OFFLINE_LOG_ENTRIES) {
            entries.splice(0, entries.length - MAX_OFFLINE_LOG_ENTRIES)
        }

        // the app may not live long enough after a crash for a delayed write
        if (entry.level === "fatal" || entry.level === "error") {
            writeEntries()
        }
        else if (!persistTimer) {
            persistTimer = setTimeout(writeEntries, PERSIST_DELAY_MS)
        }
    }
    catch {
    }
}

export function appendOfflineLog(level: OfflineLogLevel, scope: string, data: unknown[], native = false): OfflineLogEntry {
    const entry = createOfflineLogEntry(level, scope, data, native)
    persistEntry(entry)
    queueForDebugLogReceiver(sanitizeEntryForExport(entry))

    try {
        if (native) {
            ExpoOfflineLogger.append(JSON.stringify(entry))
        }
    }
    catch {
    }

    return entry
}

export function recordOfflineLog(level: OfflineLogLevel, scope: string, data: unknown[], mirrorToConsole = false) {
    if (isOfflineLoggingEnabled()) {
        appendOfflineLog(level, scope, data)
    }

    if (mirrorToConsole) {
        originalConsole[consoleMethodForLevel(level)](`[${scope}]: `, ...data)
    }
}

export function isOfflineLoggingEnabled(): boolean {
    return getStoredString(OFFLINE_LOGGING_ENABLED_STORAGE_KEY) === "true"
}

export function setOfflineLoggingEnabled(enabled: boolean) {
    if (enabled) {
        setStoredString(OFFLINE_LOGGING_ENABLED_STORAGE_KEY, "true")
        appendOfflineLog("info", "offline-logger", ["logging enabled", describeLogDevice()])
        return
    }

    appendOfflineLog("info", "offline-logger", ["logging disabled"])
    removeStoredKey(OFFLINE_LOGGING_ENABLED_STORAGE_KEY)
    writeEntries()
}

export function getOfflineLogEntries(): OfflineLogEntry[] {
    return [...loadEntries()]
}

/** Saved entries with tokens and home paths redacted, as they leave the device. */
export function getOfflineLogEntriesForExport(): OfflineLogEntry[] {
    return loadEntries().map(sanitizeEntryForExport)
}

export function getOfflineCrashEntries(): OfflineLogEntry[] {
    return getOfflineLogEntries().filter(entry => entry.level === "fatal" || entry.scope.includes("crash"))
}

export function clearOfflineLogs() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    cachedEntries = []
    removeStoredKey(OFFLINE_LOGS_STORAGE_KEY)
    ExpoOfflineLogger.clear()
    ExpoOfflineLogger.clearLastNativeCrash()
}

export async function getOfflineLogText(): Promise<string> {
    const entries = getOfflineLogEntries()
    const nativeLogs = await ExpoOfflineLogger.readNativeLogs()
    const lastNativeCrash = await ExpoOfflineLogger.getLastNativeCrash()
    const sections: string[] = []

    if (entries.length > 0) {
        sections.push([
            "# Seanime Tenji logs",
            ...entries.map(entry => JSON.stringify(sanitizeEntryForExport(entry))),
        ].join("\n"))
    }

    if (nativeLogs) {
        sections.push(["# Native logs", redactSensitiveText(nativeLogs.trim())].join("\n"))
    }

    if (lastNativeCrash) {
        sections.push(["# Last native crash", redactSensitiveText(lastNativeCrash.trim())].join("\n"))
    }

    return sections.join("\n\n")
}

export async function getOfflineCrashText(): Promise<string> {
    const entries = getOfflineCrashEntries()
    const lastNativeCrash = await ExpoOfflineLogger.getLastNativeCrash()
    const sections: string[] = []

    if (entries.length > 0) {
        sections.push([
            "# Seanime Tenji crash report",
            ...entries.map(entry => JSON.stringify(sanitizeEntryForExport(entry))),
        ].join("\n"))
    }

    if (lastNativeCrash) {
        sections.push(["# Last native crash", redactSensitiveText(lastNativeCrash.trim())].join("\n"))
    }

    return sections.join("\n\n")
}

export async function copyOfflineLogsToClipboard(): Promise<boolean> {
    const text = await getOfflineLogText()
    if (!text.trim()) return false

    return copyOfflineLogTextToClipboard(text)
}

export function copyOfflineLogTextToClipboard(text: string): boolean {
    return ExpoOfflineLogger.copyToClipboard(text)
}

function patchConsole() {
    if (consolePatched) return
    consolePatched = true

    const methods: ConsoleMethod[] = ["debug", "info", "log", "warn", "error"]

    for (const method of methods) {
        console[method] = (...data: unknown[]) => {
            recordOfflineLog(levelForConsoleMethod(method), "console", data)
            originalConsole[method](...data)
        }
    }
}

function installGlobalErrorHandler() {
    const globalWithHooks = globalThis as GlobalWithErrorHooks
    const errorUtils = globalWithHooks.ErrorUtils
    const previousHandler = errorUtils?.getGlobalHandler?.()

    errorUtils?.setGlobalHandler?.((error, isFatal) => {
        appendOfflineLog(isFatal ? "fatal" : "error", "js-error", [error, `fatal=${isFatal ? "true" : "false"}`])
        previousHandler?.(error, isFatal)
    })

    const previousUnhandledRejection = globalWithHooks.onunhandledrejection
    globalWithHooks.onunhandledrejection = event => {
        appendOfflineLog("error", "unhandled-rejection", [event.reason ?? "unknown rejection"])
        previousUnhandledRejection?.(event)
    }

    globalWithHooks.addEventListener?.("unhandledrejection", event => {
        appendOfflineLog("error", "unhandled-rejection", [event.reason ?? "unknown rejection"])
    })
}

function capturePreviousNativeCrash() {
    void ExpoOfflineLogger.getLastNativeCrash().then(crash => {
        if (!crash) return

        appendOfflineLog("fatal", "native-crash", [crash], true)
        ExpoOfflineLogger.clearLastNativeCrash()
    }).catch(() => {
    })
}

export function installOfflineLogger() {
    if (installed) return
    installed = true

    try {
        ExpoOfflineLogger.install()
    }
    catch {
    }

    capturePreviousNativeCrash()
    patchConsole()
    installGlobalErrorHandler()

    // write pending entries before the OS suspends or closes the app
    try {
        AppState.addEventListener("change", state => {
            if (state !== "active") writeEntries()
        })
    }
    catch {
    }

    if (isOfflineLoggingEnabled()) {
        appendOfflineLog("info", "session", ["app started", describeLogDevice()])
    }
}
