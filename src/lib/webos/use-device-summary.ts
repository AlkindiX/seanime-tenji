export type DeviceSummary = {
    /** "OLED55C1PUB · webOS 6.3.0 · 4K · HDR10 · Dolby Vision" */
    device: string
    /** Video formats the TV says it decodes, e.g. ["H.264", "HEVC Main10", "VP9"]. */
    formats: string[]
}

/** Only the webOS build can ask the TV about itself; see use-device-summary.web.ts. */
export function useDeviceSummary(): DeviceSummary | null {
    return null
}
