import { registerRootComponent } from "expo"
import { ExpoRoot } from "expo-router"
import { installOfflineLogger } from "./src/lib/offline-logger"

installOfflineLogger()

// https://docs.expo.dev/router/reference/troubleshooting/#expo_router_app_root-not-defined

// The webOS app loads from file://; start the router at "/" rather than at the file's path.
const initialLocation = typeof window !== "undefined" && window.location?.protocol === "file:" ? "/" : undefined

// Must be exported or Fast Refresh won't update the context
export function App() {
    const ctx = require.context("./app")
    return <ExpoRoot context={ctx} location={initialLocation} />
}

registerRootComponent(App)
