/**
 * What the TV says about itself: model, webOS version and the display
 * capabilities the playback decision needs (UHD panel, HDR10, Dolby Vision).
 *
 * The model and version come from `deviceInfo`, a JSON string on
 * webOSSystem/PalmSystem that needs no permission. The capabilities come from
 * two Luna calls, the same ones webOSTV.js's `deviceInfo()` makes; both need
 * the `systemconfig.query` ACG on webOS TV 26 and later. Every field is
 * optional: a desktop browser, a refused call or a timeout leaves it out.
 */
// The extension lets the node tests load this file directly.
import { lunaCall } from "./luna.ts"

export type DeviceInfo = {
    model?: string
    /** Platform version as the TV reports it, e.g. "6.3.0". */
    webOSVersion?: string
    firmware?: string
    sdkVersion?: string
    uhd?: boolean
    hdr10?: boolean
    dolbyVision?: boolean
}

type DeviceInfoJson = {
    modelName?: unknown
    platformVersion?: unknown
    platformVersionMajor?: unknown
    platformVersionMinor?: unknown
    platformVersionDot?: unknown
    screenWidth?: unknown
}

type SystemWindow = {
    webOSSystem?: { deviceInfo?: unknown }
    PalmSystem?: { deviceInfo?: unknown }
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined

/** Parses the `deviceInfo` string; malformed or missing data gives `{}`. */
export function parseDeviceInfoString(raw: unknown): DeviceInfo {
    if (typeof raw !== "string" || !raw) return {}
    let json: DeviceInfoJson
    try {
        json = JSON.parse(raw) as DeviceInfoJson
    } catch {
        return {}
    }
    if (!json || typeof json !== "object") return {}

    const info: DeviceInfo = {}
    const model = text(json.modelName)
    if (model) info.model = model

    const version = text(json.platformVersion)
        ?? (json.platformVersionMajor != null
            ? [json.platformVersionMajor, json.platformVersionMinor, json.platformVersionDot].filter(part => part != null).join(".")
            : undefined)
    if (version) info.webOSVersion = version

    // screenWidth can be the UI size rather than the panel's, so it only ever confirms UHD.
    if (typeof json.screenWidth === "number" && json.screenWidth >= 3840) info.uhd = true
    return info
}

/** Merges a `getSystemInfo` response (values are strings, UHD is "true"/"false"). */
export function mergeSystemInfo(info: DeviceInfo, response: Record<string, unknown> | null): DeviceInfo {
    if (!response) return info
    const next = { ...info }
    const model = text(response.modelName)
    if (model) next.model = model
    const firmware = text(response.firmwareVersion)
    if (firmware && firmware !== "0.0.0") next.firmware = firmware
    const sdk = text(response.sdkVersion)
    if (sdk) next.sdkVersion = sdk
    if (response.UHD === "true" || response.UHD === true) next.uhd = true
    else if ((response.UHD === "false" || response.UHD === false) && next.uhd === undefined) next.uhd = false
    return next
}

/** Merges a `getConfigs` response; it wins over `getSystemInfo`, as in webOSTV.js. */
export function mergeConfigs(info: DeviceInfo, response: Record<string, unknown> | null): DeviceInfo {
    const configs = response?.configs
    if (!configs || typeof configs !== "object") return info
    const values = configs as Record<string, unknown>
    const next = { ...info }

    const panel = text(values["tv.hw.panelResolution"])
    if (panel) next.uhd = panel === "UD" || panel === "8K"
    if (typeof values["tv.model.supportHDR"] === "boolean") next.hdr10 = values["tv.model.supportHDR"] as boolean
    if (typeof values["tv.config.supportDolbyHDRContents"] === "boolean") {
        next.dolbyVision = values["tv.config.supportDolbyHDRContents"] as boolean
    }
    return next
}

function systemDeviceInfo(): unknown {
    if (typeof window === "undefined") return undefined
    const w = window as SystemWindow
    return w.webOSSystem?.deviceInfo ?? w.PalmSystem?.deviceInfo
}

function onTV() {
    if (typeof window === "undefined") return false
    const w = window as SystemWindow
    return !!(w.webOSSystem || w.PalmSystem)
}

async function readDeviceInfo(timeoutMs: number): Promise<DeviceInfo> {
    if (!onTV()) return {}
    let info = parseDeviceInfoString(systemDeviceInfo())

    const [system, configs] = await Promise.all([
        lunaCall("luna://com.webos.service.tv.systemproperty/getSystemInfo", {
            keys: ["modelName", "firmwareVersion", "UHD", "sdkVersion"],
        }, { timeoutMs }),
        lunaCall("luna://com.webos.service.config/getConfigs", {
            configNames: ["tv.model.supportHDR", "tv.config.supportDolbyHDRContents", "tv.hw.panelResolution"],
        }, { timeoutMs }),
    ])
    info = mergeSystemInfo(info, system)
    info = mergeConfigs(info, configs)
    return info
}

let cached: Promise<DeviceInfo> | null = null

/** Read once per launch; later calls share the first result. */
export function getDeviceInfo({ timeoutMs = 3000 } = {}): Promise<DeviceInfo> {
    cached ??= readDeviceInfo(timeoutMs).catch(() => ({}))
    return cached
}

/** For tests. */
export function resetDeviceInfoCache() {
    cached = null
}

/** "OLED55C1PUB · webOS 6.3.0 · 4K · HDR10 · Dolby Vision", or null when nothing is known. */
export function describeDevice(info: DeviceInfo): string | null {
    const parts: string[] = []
    if (info.model) parts.push(info.model)
    if (info.webOSVersion) parts.push(`webOS ${info.webOSVersion}`)
    if (info.uhd !== undefined) parts.push(info.uhd ? "4K" : "Full HD")
    if (info.hdr10) parts.push("HDR10")
    if (info.dolbyVision) parts.push("Dolby Vision")
    return parts.length > 0 ? parts.join(" · ") : null
}
