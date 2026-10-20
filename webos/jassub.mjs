#!/usr/bin/env node
/**
 * Prebuilds JASSUB (libass in WebAssembly) for the web player's ASS subtitles:
 *
 *   node webos/jassub.mjs <dir>
 *
 * writes <dir>/jassub.js (the JASSUB class as `window.JASSUB`), <dir>/worker.js,
 * both wasm builds and the default font. The webOS build writes them to the
 * app's `jassub/`; `npm run dev:webos` to `public/jassub`, which the dev server
 * serves. See modules/expo-mpv-player/src/web/libass.ts for how they load.
 *
 * Both scripts are classic (IIFE): the TV's file:// app can't import modules
 * into a worker, and a classic script also runs where `type: "module"`
 * workers don't exist (Chromium 79, webOS 6).
 */
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const esbuild = require("esbuild")

// webOS 6 (2021 TVs) ships Chromium 79.
const TARGET = "chrome79"

export async function buildJassub(outDir) {
    const dist = path.dirname(require.resolve("jassub"))
    fs.mkdirSync(outDir, { recursive: true })

    const common = {
        bundle: true,
        minify: true,
        format: "iife",
        target: TARGET,
        legalComments: "none",
        // The worker runs from a blob: URL, which can't be a URL base; the URLs
        // built from this are never loaded (JASSUB is handed every file).
        define: { "import.meta.url": JSON.stringify("https://jassub.invalid/") },
        logLevel: "warning",
    }
    await esbuild.build({
        ...common,
        stdin: {
            contents: "import JASSUB from \"jassub\"\nself.JASSUB = JASSUB\n",
            resolveDir: dist,
        },
        outfile: path.join(outDir, "jassub.js"),
    })
    await esbuild.build({
        ...common,
        entryPoints: [path.join(dist, "worker", "worker.js")],
        outfile: path.join(outDir, "worker.js"),
    })

    fs.copyFileSync(path.join(dist, "wasm", "jassub-worker.wasm"), path.join(outDir, "jassub-worker.wasm"))
    fs.copyFileSync(path.join(dist, "wasm", "jassub-worker-modern.wasm"), path.join(outDir, "jassub-worker-modern.wasm"))
    fs.copyFileSync(path.join(dist, "default.woff2"), path.join(outDir, "default.woff2"))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const outDir = process.argv[2]
    if (!outDir) {
        console.error("Usage: node webos/jassub.mjs <output dir>")
        process.exit(1)
    }
    await buildJassub(path.resolve(outDir))
    console.log(`JASSUB written to ${path.relative(process.cwd(), path.resolve(outDir)) || "."}`)
}
