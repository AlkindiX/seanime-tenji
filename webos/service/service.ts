/**
 * Tenji's webOS JS service. webos/build.mjs bundles it with `ws` 7 for Node 8 (webOS 6) and
 * packages it in the IPK as `<app id>.service`; see relay.ts for what it does.
 */
import { createRelay } from "./relay.ts"

/** Set by the build from appinfo.json. */
declare const SERVICE_ID: string

// The TV provides webos-service; the build leaves it out of the bundle.
const Service = require("webos-service")
const WebSocket = require("ws")

const service = new Service(SERVICE_ID)
// An open subscription keeps the service running; between reconnect attempts (up to 30 s apart)
// it would otherwise exit after 5 s and start Node again for the next one.
if (service.activityManager) service.activityManager.idleTimeout = 35

const relay = createRelay(WebSocket, { log: line => console.log(`[relay] ${line}`) })

// A method with a cancel handler takes subscriptions.
service.register("connect", relay.connect, relay.cancel)
service.register("send", relay.send)
service.register("close", relay.close)
