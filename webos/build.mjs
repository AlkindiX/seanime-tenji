#!/usr/bin/env node
/**
 * Builds Seanime Tenji for LG webOS TVs: `npm run build:webos`
 *
 *   dist/webos/app/                         the packaged web app (appinfo.json + files)
 *   dist/webos/service/                     the app's JS service, the WebSocket relay (webos/service/)
 *   dist/webos/app.seanime.tenji_<v>_all.ipk  installable package (ares-install, Homebrew Channel, Dev Manager)
 *
 * Steps: check the appinfo.json images, export the TV interface for web with
 * Expo, make every URL relative (webOS loads the app from file://), lower JS
 * and CSS for older TV browsers, add polyfills and libass (JASSUB, for ASS
 * subtitles), bundle the JS service for Node 8, then write the IPK.
 *
 * Flags: --skip-export  reuse dist/webos/www from a previous run
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"
import { buildJassub } from "./jassub.mjs"
import { buildService, SERVICE_NODE } from "./service-build.mjs"

const require = createRequire(import.meta.url)
const esbuild = require("esbuild")
const { transform: transformCss } = require("lightningcss")
const coreJsCompat = require("core-js-compat")

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webosDir = path.join(root, "webos")
const outDir = path.join(root, "dist", "webos")
const exportDir = path.join(outDir, "www")
const appDir = path.join(outDir, "app")
const serviceDir = path.join(outDir, "service")

// webOS 6 (2021 TVs) ships Chromium 79; later releases only move forward.
const CHROME = 79

const args = new Set(process.argv.slice(2))

function log(message) {
    console.log(`\x1b[36m[webos]\x1b[0m ${message}`)
}

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        return entry.isDirectory() ? walk(full) : [full]
    })
}

///////////////////////////////////////////////////////////////////////////////
// Export
///////////////////////////////////////////////////////////////////////////////

function exportWeb() {
    log("Exporting the TV interface for web…")
    fs.rmSync(exportDir, { recursive: true, force: true })
    const result = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", exportDir, "--clear"], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, EXPO_TV: "1", SEANIME_WEBOS: "1", NODE_ENV: "production" },
        // npx is npx.cmd on Windows, which Node only starts through a shell
        shell: process.platform === "win32",
    })
    if (result.status !== 0) {
        throw new Error(`expo export failed${result.error ? `: ${result.error.message}` : ""}`)
    }
}

///////////////////////////////////////////////////////////////////////////////
// Rewrites
///////////////////////////////////////////////////////////////////////////////

/** Root-relative URLs would resolve to file:///_expo/… on the TV. */
function rewriteIndexHtml(file) {
    let html = fs.readFileSync(file, "utf8")
    html = html.replace(/(src|href)="\/(?!\/)/g, "$1=\"./")
    // Polyfills must run before the (deferred) app bundle.
    html = html.replace("</title>", "</title>\n    <script src=\"./polyfills.js\"></script>")
    html = html.replace(/\s*<noscript>[\s\S]*?<\/noscript>/, "")
    fs.writeFileSync(file, html)
}

async function lowerJs(file) {
    const source = fs.readFileSync(file, "utf8").replaceAll("\"/assets/", "\"./assets/")
    const result = await esbuild.transform(source, {
        loader: "js",
        target: `chrome${CHROME}`,
        // Metro's output is already minified; identifiers stay as they are.
        minifyWhitespace: true,
        minifySyntax: true,
        legalComments: "none",
        charset: "utf8",
    })
    fs.writeFileSync(file, result.code)
}

/** Index of the brace closing the one at `open`, skipping strings. */
function matchingBrace(css, open) {
    let depth = 0
    let quote = null
    for (let i = open; i < css.length; i++) {
        const char = css[i]
        if (quote) {
            if (char === "\\") i++
            else if (char === quote) quote = null
        } else if (char === "\"" || char === "'") {
            quote = char
        } else if (char === "{") {
            depth++
        } else if (char === "}" && --depth === 0) {
            return i
        }
    }
    throw new Error("Unbalanced braces in CSS")
}

/** Replaces `@layer x { … }` with its rules (layers are declared in source order) and drops `@layer x, y;`. */
function flattenLayers(css) {
    let out = ""
    let index = 0
    const pattern = /@layer\b[^;{]*([;{])/g
    for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
        out += css.slice(index, match.index)
        if (match[1] === ";") {
            index = pattern.lastIndex
            continue
        }
        const open = pattern.lastIndex - 1
        const close = matchingBrace(css, open)
        out += flattenLayers(css.slice(open + 1, close))
        index = close + 1
        pattern.lastIndex = index
    }
    return out + css.slice(index)
}

/** Physical sides of the logical shorthands, for the app's left-to-right layout. */
const LOGICAL_SIDES = { inline: ["left", "right"], block: ["top", "bottom"] }
const LOGICAL_SHORTHAND = /([{;])(padding|margin|inset|border)-(inline|block)(-(?:style|width|color))?:([^;}]+)/g

/**
 * `padding-inline`, `margin-block`, `inset-inline`, `border-inline-style`…
 * as physical properties. They need Chromium 87, and lightningcss only lowers
 * values it can parse, so Tailwind's `calc(var(--spacing) * N)` is left as is.
 */
function lowerLogicalShorthands(css, splitTopLevel) {
    return css.replace(LOGICAL_SHORTHAND, (whole, lead, property, axis, part = "", rawValue) => {
        const important = /\s*!important\s*$/i.exec(rawValue)
        const value = important ? rawValue.slice(0, important.index) : rawValue
        const suffix = important ? "!important" : ""
        // `border-inline: 1px solid` sets both sides alike; the others take "start end".
        const parts = property === "border" && !part ? [value.trim()] : splitTopLevel(value)
        if (parts.length < 1 || parts.length > 2) return whole
        const [start, end = parts[0]] = parts
        const [first, second] = LOGICAL_SIDES[axis]
        const name = side => property === "inset" ? side : `${property}-${side}${part}`
        return `${lead}${name(first)}:${start}${suffix};${name(second)}:${end}${suffix}`
    })
}

/**
 * Tailwind v4 puts every rule in cascade layers and uses `@property` and the
 * individual `translate`/`scale`/`rotate` properties, none of which exist
 * before Chromium 99/85/104. Layers are flattened (in their declared order,
 * which is source order), `@property` initial values become plain custom
 * property defaults, the transform properties become `transform`, and the
 * logical shorthands (Chromium 87) become physical properties.
 */
function lowerCss(file) {
    const source = fs.readFileSync(file, "utf8")

    const defaults = []
    for (const match of source.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)) {
        const initial = /initial-value\s*:\s*([^;}]+)/.exec(match[2])
        if (initial) defaults.push(`${match[1]}:${initial[1].trim()}`)
    }

    const { code } = transformCss({
        filename: path.basename(file),
        code: Buffer.from(flattenLayers(source)),
        minify: true,
        targets: { chrome: CHROME << 16 },
    })

    const splitTopLevel = (value) => {
        const parts = []
        let depth = 0
        let current = ""
        for (const char of value.trim()) {
            if (char === "(") depth++
            if (char === ")") depth--
            if (char === " " && depth === 0) {
                if (current) parts.push(current)
                current = ""
            } else {
                current += char
            }
        }
        if (current) parts.push(current)
        return parts
    }

    let css = code.toString().replace(/([{;])(translate|scale|rotate):([^;}]+)/g, (whole, lead, property, value) => {
        if (value.trim() === "none") return `${lead}transform:none`
        const parts = splitTopLevel(value)
        if (property === "rotate" && parts.length !== 1) return whole
        return `${lead}transform:${property}(${parts.slice(0, 2).join(",")})`
    })
    css = lowerLogicalShorthands(css, splitTopLevel)
    const left = css.match(LOGICAL_SHORTHAND)
    if (left) throw new Error(`Logical shorthands Chromium ${CHROME} drops are still in ${path.basename(file)}: ${left.slice(0, 5).join(" ")}`)

    if (defaults.length > 0) {
        css = `*,:before,:after{${defaults.join(";")}}${css}`
    }
    fs.writeFileSync(file, css)
}

async function buildPolyfills(file) {
    const { list } = coreJsCompat({
        targets: { chrome: String(CHROME) },
        modules: ["core-js/stable"],
        version: require("core-js/package.json").version,
    })
    log(`Bundling ${list.length} core-js polyfills for Chromium ${CHROME}…`)
    await esbuild.build({
        stdin: {
            contents: list.map(name => `import "core-js/modules/${name}.js"`).join("\n"),
            resolveDir: root,
        },
        bundle: true,
        minify: true,
        format: "iife",
        target: `chrome${CHROME}`,
        legalComments: "none",
        outfile: file,
    })
}

///////////////////////////////////////////////////////////////////////////////
// appinfo.json images
///////////////////////////////////////////////////////////////////////////////

/** Image fields of appinfo.json and the size LG's appinfo.json reference asks for. */
const APPINFO_IMAGES = {
    icon: [80, 80],
    largeIcon: [130, 130],
    splashBackground: [1920, 1080],
}

/** Width and height from a PNG's IHDR chunk, or null when the file isn't a PNG. */
function pngSize(file) {
    const header = Buffer.alloc(24)
    const fd = fs.openSync(file, "r")
    try {
        fs.readSync(fd, header, 0, 24, 0)
    } finally {
        fs.closeSync(fd)
    }
    const signature = "89504e470d0a1a0a"
    if (header.subarray(0, 8).toString("hex") !== signature || header.toString("ascii", 12, 16) !== "IHDR") return null
    return [header.readUInt32BE(16), header.readUInt32BE(20)]
}

function checkPng(file, field, [width, height]) {
    if (!fs.existsSync(file)) {
        throw new Error(`appinfo.json ${field}: ${path.relative(root, file)} is missing`)
    }
    const size = pngSize(file)
    if (!size) {
        throw new Error(`appinfo.json ${field}: ${path.relative(root, file)} is not a PNG`)
    }
    if (size[0] !== width || size[1] !== height) {
        throw new Error(`appinfo.json ${field}: ${path.relative(root, file)} is ${size[0]}x${size[1]}, webOS expects ${width}x${height}`)
    }
}

///////////////////////////////////////////////////////////////////////////////
// IPK
///////////////////////////////////////////////////////////////////////////////

function octal(value, length) {
    return value.toString(8).padStart(length - 1, "0") + "\0"
}

function tarHeader(name, size, type, mode) {
    const header = Buffer.alloc(512)
    let prefix = ""
    let shortName = name
    if (Buffer.byteLength(name) > 100) {
        // ustar stores long paths as prefix (<= 155 bytes) + "/" + name (<= 100 bytes).
        const cut = [...name.slice(0, -1).matchAll(/\//g)]
            .map(match => match.index)
            .find(index => Buffer.byteLength(name.slice(index + 1)) <= 100)
        if (cut === undefined || Buffer.byteLength(name.slice(0, cut)) > 155) {
            throw new Error(`Path too long for the IPK: ${name}`)
        }
        prefix = name.slice(0, cut)
        shortName = name.slice(cut + 1)
    }

    header.write(shortName, 0, 100)
    header.write(octal(mode, 8), 100)
    header.write(octal(0, 8), 108)
    header.write(octal(0, 8), 116)
    header.write(octal(size, 12), 124)
    header.write(octal(Math.floor(Date.now() / 1000), 12), 136)
    header.write("        ", 148)
    header.write(type, 156)
    header.write("ustar\0", 257)
    header.write("00", 263)
    header.write("root", 265)
    header.write("root", 297)
    header.write(prefix, 345, 155)

    let checksum = 0
    for (const byte of header) checksum += byte
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148)
    return header
}

/** entries: [{ name: "usr/", dir: true, mode? } | { name: "usr/x", data: Buffer }] */
function targz(entries) {
    const chunks = []
    for (const entry of entries) {
        if (entry.dir) {
            chunks.push(tarHeader(entry.name, 0, "5", entry.mode ?? 0o755))
            continue
        }
        chunks.push(tarHeader(entry.name, entry.data.length, "0", 0o644), entry.data)
        const padding = (512 - (entry.data.length % 512)) % 512
        if (padding) chunks.push(Buffer.alloc(padding))
    }
    chunks.push(Buffer.alloc(1024))
    return zlib.gzipSync(Buffer.concat(chunks), { level: 9 })
}

function ar(members) {
    const chunks = [Buffer.from("!<arch>\n")]
    const mtime = String(Math.floor(Date.now() / 1000))
    for (const { name, data } of members) {
        const header = name.padEnd(16) + mtime.padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "100644".padEnd(8) + String(data.length).padEnd(10) + "`\n"
        chunks.push(Buffer.from(header), data)
        if (data.length % 2) chunks.push(Buffer.from("\n"))
    }
    return Buffer.concat(chunks)
}

function directoryEntries(filePath) {
    const parts = filePath.split("/").slice(0, -1)
    return parts.map((_, index) => `${parts.slice(0, index + 1).join("/")}/`)
}

function writeIpk(appinfo, serviceId) {
    const id = appinfo.id
    const installRoot = `usr/palm/applications/${id}`
    const serviceRoot = `usr/palm/services/${serviceId}`

    // Same layout as LG's ares-package output.
    const packageinfo = { id, version: appinfo.version, app: id, services: [serviceId] }

    const entries = []
    const dirs = new Set()
    const addFile = (name, data) => {
        for (const dir of directoryEntries(name)) {
            if (!dirs.has(dir)) {
                dirs.add(dir)
                // ares-package makes the service's own directory writable (0777); the rest is 0755.
                entries.push({ name: dir, dir: true, mode: dir === `${serviceRoot}/` ? 0o777 : 0o755 })
            }
        }
        entries.push({ name, data })
    }
    let installedSize = 0
    const addTree = (sourceDir, installDir) => {
        for (const file of walk(sourceDir).sort()) {
            const data = fs.readFileSync(file)
            installedSize += data.length
            addFile(`${installDir}/${path.relative(sourceDir, file).split(path.sep).join("/")}`, data)
        }
    }
    addTree(appDir, installRoot)
    addTree(serviceDir, serviceRoot)
    addFile(`usr/palm/packages/${id}/packageinfo.json`, Buffer.from(JSON.stringify(packageinfo, null, 2) + "\n"))

    const control = [
        `Package: ${id}`,
        `Version: ${appinfo.version}`,
        "Section: misc",
        "Priority: optional",
        "Architecture: all",
        `Installed-Size: ${installedSize}`,
        `Maintainer: ${appinfo.vendor} <noreply@seanime.app>`,
        `Description: ${appinfo.title}`,
        "webOS-Package-Format-Version: 2",
        "webOS-Packager-Version: x.y.x",
        "",
    ].join("\n")

    const ipk = ar([
        { name: "debian-binary", data: Buffer.from("2.0\n") },
        { name: "control.tar.gz", data: targz([{ name: "control", data: Buffer.from(control) }]) },
        { name: "data.tar.gz", data: targz(entries) },
    ])

    const ipkPath = path.join(outDir, `${id}_${appinfo.version}_all.ipk`)
    fs.writeFileSync(ipkPath, ipk)
    return ipkPath
}

///////////////////////////////////////////////////////////////////////////////

async function main() {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const appinfo = JSON.parse(fs.readFileSync(path.join(webosDir, "appinfo.json"), "utf8"))
    appinfo.version = pkg.version
    // Checked first so a bad image fails the build before the slow export.
    const images = Object.entries(APPINFO_IMAGES).filter(([field]) => appinfo[field])
    for (const [field, size] of images) checkPng(path.join(webosDir, appinfo[field]), field, size)

    if (!args.has("--skip-export")) exportWeb()
    if (!fs.existsSync(path.join(exportDir, "index.html"))) {
        throw new Error(`No web export at ${exportDir}; run without --skip-export`)
    }

    log("Preparing the app directory…")
    fs.rmSync(appDir, { recursive: true, force: true })
    fs.cpSync(exportDir, appDir, { recursive: true })
    fs.rmSync(path.join(appDir, "metadata.json"), { force: true })

    rewriteIndexHtml(path.join(appDir, "index.html"))
    for (const file of walk(appDir)) {
        if (file.endsWith(".js")) await lowerJs(file)
        else if (file.endsWith(".css")) lowerCss(file)
    }
    await buildPolyfills(path.join(appDir, "polyfills.js"))
    log("Bundling libass (JASSUB) for ASS subtitles…")
    await buildJassub(path.join(appDir, "jassub"))

    fs.writeFileSync(path.join(appDir, "appinfo.json"), JSON.stringify(appinfo, null, 4) + "\n")
    for (const [field] of images) {
        fs.copyFileSync(path.join(webosDir, appinfo[field]), path.join(appDir, appinfo[field]))
    }

    log(`Bundling the WebSocket relay service for Node ${SERVICE_NODE}…`)
    const serviceId = await buildService({ appId: appinfo.id, version: appinfo.version, outDir: serviceDir })

    const ipkPath = writeIpk(appinfo, serviceId)
    log(`App directory: ${path.relative(root, appDir)}`)
    log(`Service:       ${path.relative(root, serviceDir)} (${serviceId})`)
    log(`Package:       ${path.relative(root, ipkPath)}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
