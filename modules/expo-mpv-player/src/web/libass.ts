/**
 * ASS subtitles drawn by libass (JASSUB: libass in WebAssembly, rendering in
 * a worker onto a canvas over the video), the renderer mpv uses natively.
 *
 * JASSUB's files are prebuilt by `webos/jassub.mjs` into `jassub/` next to the
 * app (`public/jassub` for the dev server): its class as a classic script
 * (`window.JASSUB`), its worker, the wasm and a default font. The packaged
 * webOS app runs from file://, where a worker can't fetch() files, so the
 * worker script and the wasm are read here and handed over as blob URLs, and
 * the font as bytes.
 */

type JassubRenderer = {
    setTrack: (content: string) => Promise<void>
    processChunk: (data: string, timecode: number, duration: number) => Promise<void>
}

type JassubInstance = {
    ready: Promise<void>
    renderer: JassubRenderer
    timeOffset: number
    _worker: Worker
    destroy: () => Promise<void>
}

type JassubClass = {
    new (options: Record<string, unknown>): JassubInstance
    _test: () => void
    _supportsSIMD?: boolean
}

type Assets = {
    JASSUB: JassubClass
    workerUrl: string
    wasmUrl: string
    defaultFont: Uint8Array
}

export type AssChunk = { data: string; start: number; duration: number }

/** An empty script, for "no track": libass then draws nothing. */
const EMPTY_SCRIPT = "[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
const DEFAULT_FONT = "liberation sans"
const READY_TIMEOUT_MS = 15_000

function assetUrl(name: string) {
    // file://: the document stays at index.html (see webos/install.ts); http: routes are paths, so go from the root.
    const base = window.location.protocol === "file:" ? "./jassub/" : "/jassub/"
    return new URL(base + name, document.baseURI).href
}

/** XHR rather than fetch(), which Chromium refuses for file:// URLs. */
function read<T extends "text" | "arraybuffer">(url: string, type: T): Promise<T extends "text" ? string : ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", url)
        xhr.responseType = type
        // file:// answers with status 0.
        xhr.onload = () => (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) && xhr.response != null
            ? resolve(xhr.response)
            : reject(new Error(`Could not load ${url} (${xhr.status})`))
        xhr.onerror = () => reject(new Error(`Could not load ${url}`))
        xhr.send()
    })
}

function loadScript(url: string) {
    return new Promise<void>((resolve, reject) => {
        const script = document.createElement("script")
        script.src = url
        script.onload = () => resolve()
        script.onerror = () => reject(new Error(`Could not load ${url}`))
        document.head.appendChild(script)
    })
}

let assets: Promise<Assets> | null = null

function loadAssets(): Promise<Assets> {
    assets ??= (async () => {
        const global = window as unknown as { JASSUB?: JassubClass }
        if (!global.JASSUB) await loadScript(assetUrl("jassub.js"))
        const JASSUB = global.JASSUB
        if (!JASSUB) throw new Error("JASSUB did not load")

        // Throws without WebAssembly; picks the SIMD build where it runs.
        JASSUB._test()
        const wasmName = JASSUB._supportsSIMD ? "jassub-worker-modern.wasm" : "jassub-worker.wasm"
        const [worker, wasm, font] = await Promise.all([
            read(assetUrl("worker.js"), "text"),
            read(assetUrl(wasmName), "arraybuffer"),
            read(assetUrl("default.woff2"), "arraybuffer"),
        ])
        return {
            JASSUB,
            workerUrl: URL.createObjectURL(new Blob([worker], { type: "text/javascript" })),
            wasmUrl: URL.createObjectURL(new Blob([wasm], { type: "application/wasm" })),
            defaultFont: new Uint8Array(font),
        }
    })()
    // A failed load (an old TV, missing files) is not retried.
    return assets
}

export function supportsLibass() {
    return typeof Worker !== "undefined"
        && typeof WebAssembly !== "undefined"
        && typeof HTMLCanvasElement !== "undefined"
        && "transferControlToOffscreen" in HTMLCanvasElement.prototype
}

export class LibassRenderer {
    private constructor(
        private readonly instance: JassubInstance,
        private readonly canvas: HTMLCanvasElement,
    ) {}

    /**
     * Starts libass on a canvas inside `host`, which must cover the video
     * element (JASSUB sizes the canvas to the video's picture). Rejects when
     * the TV can't run it.
     */
    static async create(video: HTMLVideoElement, host: HTMLElement, fonts: string[]): Promise<LibassRenderer> {
        if (!supportsLibass()) throw new Error("This browser can't run libass (no OffscreenCanvas or WebAssembly)")
        const { JASSUB, workerUrl, wasmUrl, defaultFont } = await loadAssets()

        const canvas = document.createElement("canvas")
        canvas.style.position = "absolute"
        canvas.style.pointerEvents = "none"
        host.appendChild(canvas)

        let instance: JassubInstance
        try {
            instance = new JASSUB({
                video,
                canvas,
                subContent: EMPTY_SCRIPT,
                workerUrl,
                wasmUrl,
                modernWasmUrl: wasmUrl,
                fonts,
                availableFonts: { [DEFAULT_FONT]: defaultFont },
                defaultFont: DEFAULT_FONT,
                // No Local Font Access on a TV; don't ask for the permission.
                queryFonts: false,
                // A 4K panel still gets 1080p subtitles, as the UI is laid out at 1080p.
                maxRenderHeight: 1080,
            })
        } catch (error) {
            canvas.remove()
            throw error
        }

        const renderer = new LibassRenderer(instance, canvas)
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("libass did not start in time")), READY_TIMEOUT_MS)
                instance._worker.addEventListener("error", (event) => {
                    clearTimeout(timer)
                    reject(new Error(`libass worker failed: ${event.message || "error"}`))
                })
                instance.ready.then(() => {
                    clearTimeout(timer)
                    // The worker's constructor logs and swallows its own errors.
                    if (instance.renderer) resolve()
                    else reject(new Error("libass did not start"))
                }, (error: unknown) => {
                    clearTimeout(timer)
                    reject(error)
                })
            })
        } catch (error) {
            renderer.destroy()
            throw error
        }
        return renderer
    }

    async setTrack(script: string | null) {
        await this.instance.renderer.setTrack(script ?? EMPTY_SCRIPT)
    }

    async addChunks(chunks: readonly AssChunk[]) {
        for (const chunk of chunks) {
            await this.instance.renderer.processChunk(chunk.data, chunk.start, chunk.duration)
        }
    }

    /** Subtitle delay in seconds: positive shows them later. */
    setDelay(delay: number) {
        this.instance.timeOffset = -delay
    }

    setVisible(visible: boolean) {
        this.canvas.style.visibility = visible ? "visible" : "hidden"
    }

    destroy() {
        void this.instance.destroy().catch(() => undefined)
        this.canvas.remove()
    }
}
