#!/usr/bin/env node
/**
 * Serves a webOS build in a desktop browser: `npm run serve:webos [-- <port> [<dir>]]`
 * (`<dir>` defaults to dist/webos/app; any `expo export --platform web` output works).
 *
 * The packaged app expects file://, where the document stays at index.html.
 * Over http the router moves to /entry/anime/…, so routes get index.html and
 * the build's relative asset paths (_expo/, assets/, jassub/, polyfills.js),
 * which then resolve under the route, are mapped back to the app root.
 */
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const port = Number(process.argv[2] ?? 8090)
const root = path.resolve(repo, process.argv[3] ?? path.join("dist", "webos", "app"))

const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
}

function resolve(pathname) {
    const direct = path.join(root, pathname)
    if (!direct.startsWith(root)) return path.join(root, "index.html")
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct

    const asset = /\/((?:_expo|assets|jassub)\/.*)$/.exec(pathname)
    if (asset && fs.existsSync(path.join(root, asset[1]))) return path.join(root, asset[1])
    const top = path.join(root, path.basename(pathname))
    if (path.extname(pathname) && fs.existsSync(top)) return top
    return path.join(root, "index.html")
}

if (!fs.existsSync(path.join(root, "index.html"))) {
    console.error(`No build at ${root}; run npm run build:webos first`)
    process.exit(1)
}

http.createServer((req, res) => {
    const file = resolve(decodeURIComponent(new URL(req.url, "http://localhost").pathname))
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" })
    fs.createReadStream(file).pipe(res)
}).listen(port, "127.0.0.1", () => console.log(`webOS build on http://localhost:${port}`))
