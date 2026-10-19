#!/usr/bin/env node
// Receives debug logs from Seanime Tenji (Settings › Diagnostics › Log Receiver) and
// prints them as they arrive, for TVs that can't copy logs off themselves.
//
//   npm run debug:logs              # listens on port 8787
//   npm run debug:logs -- 9000      # another port
//
// Every line is also written to debug-logs/tenji-<date>.log, one JSON entry per line,
// ready to attach to a bug report. Tokens are redacted on the device before sending.

import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787)
const outDir = path.resolve("debug-logs")
fs.mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const outFile = path.join(outDir, `tenji-${stamp}.log`)
const out = fs.createWriteStream(outFile, { flags: "a" })

const COLORS = {
    debug: "\x1b[90m",
    info: "\x1b[37m",
    success: "\x1b[32m",
    warning: "\x1b[33m",
    error: "\x1b[31m",
    fatal: "\x1b[41m\x1b[97m",
}
const RESET = "\x1b[0m"
const useColor = process.stdout.isTTY

let lastDevice = ""
let seen = new Set()

function printEntry(entry) {
    const time = typeof entry.timestamp === "string" ? entry.timestamp.slice(11, 23) : "--:--:--.---"
    const level = String(entry.level ?? "info")
    const line = `${time} ${level.toUpperCase().padEnd(7)} [${entry.scope ?? "?"}] ${entry.message ?? ""}`
    console.log(useColor ? `${COLORS[level] ?? ""}${line}${RESET}` : line)
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        // Chromium's Private Network Access preflight, for pages on public origins
        "Access-Control-Allow-Private-Network": "true",
    }
}

const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders())
        res.end()
        return
    }

    if (req.method !== "POST") {
        res.writeHead(200, { ...corsHeaders(), "Content-Type": "text/plain" })
        res.end("Seanime Tenji log receiver is running.\n")
        return
    }

    let body = ""
    req.setEncoding("utf8")
    req.on("data", chunk => {
        body += chunk
        if (body.length > 20_000_000) req.destroy()
    })
    req.on("end", () => {
        let payload
        try {
            payload = JSON.parse(body)
        }
        catch {
            res.writeHead(400, corsHeaders())
            res.end("Body is not JSON")
            return
        }

        const from = String(req.socket.remoteAddress ?? "").replace(/^::ffff:/, "")
        const device = JSON.stringify(payload.device ?? {})
        if (device !== lastDevice) {
            lastDevice = device
            console.log(`\n--- device ${device} (${from})`)
            out.write(JSON.stringify({ receivedAt: new Date().toISOString(), device: payload.device, from }) + "\n")
        }

        const entries = Array.isArray(payload.entries) ? payload.entries : []
        if (entries.length === 0) console.log(`--- ${from} checked the connection`)

        for (const entry of entries) {
            // "Send Saved Logs" resends what was already streamed live
            if (entry?.id && seen.has(entry.id)) continue
            if (entry?.id) seen.add(entry.id)
            printEntry(entry)
            out.write(JSON.stringify(entry) + "\n")
        }
        if (seen.size > 50_000) seen = new Set()

        res.writeHead(200, { ...corsHeaders(), "Content-Type": "text/plain" })
        res.end("ok")
    })
})

server.listen(port, "0.0.0.0", () => {
    const addresses = Object.values(os.networkInterfaces())
        .flat()
        .filter(info => info && info.family === "IPv4" && !info.internal)
        .map(info => `${info.address}:${port}`)

    console.log("Seanime Tenji log receiver")
    console.log(`Writing to ${outFile}`)
    console.log("On the TV: Settings › Diagnostics › Log Receiver, enter one of:")
    for (const address of addresses) console.log(`  ${address}`)
    if (addresses.length === 0) console.log(`  <this computer's IP>:${port}`)
    console.log("Allow Node through the firewall if Windows asks. Ctrl+C to stop.\n")
})
