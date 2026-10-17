import assert from "node:assert/strict"
import test from "node:test"
import {
    describeDevice,
    getDeviceInfo,
    mergeConfigs,
    mergeSystemInfo,
    parseDeviceInfoString,
    resetDeviceInfoCache,
} from "../src/lib/webos/device-info.ts"
import { lunaCall } from "../src/lib/webos/luna.ts"

const g = globalThis as { window?: unknown }

const DEVICE_INFO = JSON.stringify({
    modelName: "OLED55C1PUB",
    platformVersion: "6.3.0",
    platformVersionMajor: 6,
    platformVersionMinor: 3,
    platformVersionDot: 0,
    screenWidth: 1920,
    screenHeight: 1080,
})

const ANSWERS: Record<string, object> = {
    "luna://com.webos.service.tv.systemproperty/getSystemInfo": {
        returnValue: true, modelName: "OLED55C1PUB", firmwareVersion: "03.20.66", UHD: "true", sdkVersion: "6.3.0",
    },
    "luna://com.webos.service.config/getConfigs": {
        returnValue: true,
        configs: { "tv.model.supportHDR": true, "tv.config.supportDolbyHDRContents": true, "tv.hw.panelResolution": "UD" },
    },
}

/** A PalmServiceBridge that answers from `answers`, asynchronously like the real one; `undefined` never answers. */
function fakeBridge(answers: Record<string, object | string | undefined>, calls: string[] = []) {
    return class {
        onservicecallback?: (message: string) => void
        cancelled = false
        call(uri: string, payload: string) {
            calls.push(`${uri} ${payload}`)
            const answer = answers[uri]
            if (answer === undefined) return
            setTimeout(() => this.onservicecallback?.(typeof answer === "string" ? answer : JSON.stringify(answer)), 1)
        }
        cancel() {
            this.cancelled = true
        }
    }
}

function withWindow(value: object | undefined, run: () => Promise<void>) {
    return async () => {
        const previous = g.window
        g.window = value
        resetDeviceInfoCache()
        try {
            await run()
        } finally {
            g.window = previous
            resetDeviceInfoCache()
        }
    }
}

test("deviceInfo string parsing", () => {
    assert.deepEqual(parseDeviceInfoString(DEVICE_INFO), { model: "OLED55C1PUB", webOSVersion: "6.3.0" })
    assert.deepEqual(
        parseDeviceInfoString(JSON.stringify({ modelName: "50UP7500", platformVersionMajor: 6, platformVersionMinor: 0, platformVersionDot: 1, screenWidth: 3840 })),
        { model: "50UP7500", webOSVersion: "6.0.1", uhd: true },
    )
    assert.deepEqual(parseDeviceInfoString("not json"), {})
    assert.deepEqual(parseDeviceInfoString(undefined), {})
})

test("Luna responses are merged, configs over system info", () => {
    let info = mergeSystemInfo({ model: "x" }, { modelName: "OLED55C1PUB", UHD: "false", firmwareVersion: "0.0.0" })
    assert.deepEqual(info, { model: "OLED55C1PUB", uhd: false })
    info = mergeConfigs(info, { configs: { "tv.hw.panelResolution": "UD", "tv.model.supportHDR": true } })
    assert.deepEqual(info, { model: "OLED55C1PUB", uhd: true, hdr10: true })
    assert.deepEqual(mergeConfigs(info, null), info)
})

test("on a TV, deviceInfo and both Luna calls are combined", withWindow({}, async () => {
    const calls: string[] = []
    g.window = { PalmSystem: { deviceInfo: DEVICE_INFO }, PalmServiceBridge: fakeBridge(ANSWERS, calls) }
    const info = await getDeviceInfo()
    assert.deepEqual(info, {
        model: "OLED55C1PUB",
        webOSVersion: "6.3.0",
        firmware: "03.20.66",
        sdkVersion: "6.3.0",
        uhd: true,
        hdr10: true,
        dolbyVision: true,
    })
    assert.equal(calls.length, 2)
    assert.match(calls[0], /"keys":\["modelName","firmwareVersion","UHD","sdkVersion"\]/)
    assert.equal(describeDevice(info), "OLED55C1PUB · webOS 6.3.0 · 4K · HDR10 · Dolby Vision")
    // memoised
    assert.equal(await getDeviceInfo(), info)
    assert.equal(calls.length, 2)
}))

test("a bridge that never answers times out with the deviceInfo data", withWindow({}, async () => {
    g.window = { webOSSystem: { deviceInfo: DEVICE_INFO }, PalmServiceBridge: fakeBridge({}) }
    const started = Date.now()
    const info = await getDeviceInfo({ timeoutMs: 50 })
    assert.ok(Date.now() - started >= 45)
    assert.deepEqual(info, { model: "OLED55C1PUB", webOSVersion: "6.3.0" })
}))

test("a refused call (ACG) counts as unknown", withWindow({}, async () => {
    g.window = {
        PalmSystem: { deviceInfo: DEVICE_INFO },
        PalmServiceBridge: fakeBridge({
            "luna://com.webos.service.tv.systemproperty/getSystemInfo": { returnValue: false, errorCode: -1, errorText: "Permission denied" },
            "luna://com.webos.service.config/getConfigs": "{not json",
        }),
    }
    assert.deepEqual(await getDeviceInfo({ timeoutMs: 200 }), { model: "OLED55C1PUB", webOSVersion: "6.3.0" })
}))

test("a desktop browser has no device info and makes no calls", withWindow({}, async () => {
    const calls: string[] = []
    g.window = { PalmServiceBridge: fakeBridge(ANSWERS, calls) }
    assert.deepEqual(await getDeviceInfo(), {})
    assert.equal(calls.length, 0)
    assert.equal(describeDevice({}), null)
}))

test("lunaCall resolves null without a bridge", withWindow({}, async () => {
    assert.equal(await lunaCall("luna://com.webos.service.config/getConfigs"), null)
}))

test("lunaCall cancels the bridge once it has answered", withWindow({}, async () => {
    const Bridge = fakeBridge(ANSWERS)
    const instances: Array<InstanceType<typeof Bridge>> = []
    g.window = {
        PalmServiceBridge: class extends Bridge {
            constructor() {
                super()
                instances.push(this)
            }
        },
    }
    const response = await lunaCall("luna://com.webos.service.config/getConfigs", {})
    assert.equal(response?.returnValue, true)
    assert.equal(instances[0].cancelled, true)
}))
