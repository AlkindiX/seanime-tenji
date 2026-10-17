import * as React from "react"
import { describeDevice, getDeviceInfo } from "./device-info"
import { browserCodecProbe, decodableFormats } from "./playback-capabilities"
import type { DeviceSummary } from "./use-device-summary"

/** The TV's model, version and decodable formats; null outside a TV or until known. */
export function useDeviceSummary(): DeviceSummary | null {
    const [summary, setSummary] = React.useState<DeviceSummary | null>(null)

    React.useEffect(() => {
        let cancelled = false
        void getDeviceInfo().then((info) => {
            const device = describeDevice(info)
            if (cancelled || !device) return
            setSummary({ device, formats: decodableFormats(browserCodecProbe()) })
        })
        return () => {
            cancelled = true
        }
    }, [])

    return summary
}
