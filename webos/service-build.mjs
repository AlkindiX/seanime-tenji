/**
 * Builds Tenji's webOS JS service (webos/service/) into a directory ready for the IPK's
 * usr/palm/services/<id>/. Used by build.mjs and by the tests.
 */
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const esbuild = require("esbuild")

const webosDir = path.dirname(fileURLToPath(import.meta.url))

// webOS 6 (and 5) run JS services on Node 8.12; webOS 22 and 23 on Node 12, later releases newer.
export const SERVICE_NODE = "8.12"

/** LG asks for `<app id>.<name>`; the app calls it as luna://<this id>/<method>. */
export function serviceIdFor(appId) {
    return `${appId}.service`
}

export async function buildService({ appId, version, outDir }) {
    const id = serviceIdFor(appId)
    // ws 8 needs Node 10. A plain `npm install` brings in 7 through package.json.
    const wsPackage = require.resolve("ws/package.json")
    const wsVersion = JSON.parse(fs.readFileSync(wsPackage, "utf8")).version
    if (!wsVersion.startsWith("7.")) {
        throw new Error(`The webOS service needs ws 7 for Node ${SERVICE_NODE}, found ws ${wsVersion}. Run npm install.`)
    }

    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })
    await esbuild.build({
        entryPoints: [path.join(webosDir, "service", "service.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        target: `node${SERVICE_NODE}`,
        // webos-service comes with the TV; ws only tries its native helpers and falls back without them.
        external: ["webos-service", "bufferutil", "utf-8-validate"],
        define: { SERVICE_ID: JSON.stringify(id) },
        legalComments: "none",
        logLevel: "warning",
        outfile: path.join(outDir, "service.js"),
    })
    fs.copyFileSync(path.join(path.dirname(wsPackage), "LICENSE"), path.join(outDir, "LICENSE-ws"))

    const description = "Seanime Tenji WebSocket relay"
    const write = (name, value) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 4) + "\n")
    write("package.json", { name: id, version, description, main: "service.js" })
    write("services.json", { id, description, services: [{ name: id, description }] })
    return id
}
