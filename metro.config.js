const path = require("path")
const { getDefaultConfig } = require("expo/metro-config")
const { withUniwindConfig } = require("uniwind/metro")

const config = getDefaultConfig(__dirname)

if (process.env.SEANIME_DISABLE_WATCHMAN === "1") {
    config.resolver.useWatchman = false
}

// LG webOS runs the TV app as a web app (react-native-web). `react-native` is
// swapped for a shim that adds the react-native-tvos APIs (focus guides,
// remote key events, preferred focus) on top of react-native-web, and
// native-only packages are swapped for web stand-ins.
const isWebOS = process.env.SEANIME_WEBOS === "1"

if (isWebOS) {
    const webosDir = path.join(__dirname, "src", "lib", "webos")
    const reactNativeShim = path.join(webosDir, "react-native-tv.tsx")
    // babel-plugin-react-native-web rewrites `import { Pressable } from "react-native"`
    // to `react-native-web/dist/exports/Pressable`, so overrides are matched on that path.
    const overrides = new Set(["BackHandler", "Keyboard", "Modal", "Platform", "Pressable", "TouchableHighlight", "TouchableOpacity"])
    const indexModules = new Set(["react-native", "react-native/index", "react-native-web", "react-native-web/dist/index"])
    const webStubs = {
        "expo-brightness": path.join(webosDir, "stubs", "expo-brightness.ts"),
        "expo-keep-awake": path.join(webosDir, "stubs", "expo-keep-awake.ts"),
        "react-native-volume-manager": path.join(webosDir, "stubs", "react-native-volume-manager.ts"),
    }
    // The shim itself, react-native-web and uniwind's web components wrap the
    // real react-native-web modules, so they must keep resolving to them.
    const passthrough = [
        webosDir + path.sep,
        path.join("node_modules", "react-native-web") + path.sep,
        path.join("node_modules", "uniwind") + path.sep,
    ]

    config.resolver.resolveRequest = (context, moduleName, platform) => {
        if (platform === "web"
            && moduleName === "./createOrderedCSSStyleSheet"
            && context.originModulePath.includes(path.join("StyleSheet", "dom") + path.sep)) {
            return { type: "sourceFile", filePath: path.join(webosDir, "ordered-css-stylesheet.ts") }
        }
        if (platform === "web" && !passthrough.some(dir => context.originModulePath.includes(dir))) {
            if (indexModules.has(moduleName)) {
                return { type: "sourceFile", filePath: reactNativeShim }
            }
            const deepExport = /^react-native-web\/dist\/(?:cjs\/)?exports\/([A-Za-z]+)$/.exec(moduleName)
            if (deepExport && overrides.has(deepExport[1])) {
                return { type: "sourceFile", filePath: path.join(webosDir, "overrides", `${deepExport[1]}.tsx`) }
            }
            if (webStubs[moduleName]) {
                return { type: "sourceFile", filePath: webStubs[moduleName] }
            }
        }
        return context.resolveRequest(context, moduleName, platform)
    }
}

module.exports = withUniwindConfig(config, {
    cssEntryFile: "./global.css",
    polyfills: { rem: 14 },
    dtsFile: "./uniwind-types.d.ts",
    // Uniwind has no TV variant for web; webOS builds use its web output.
    isTV: process.env.EXPO_TV === "1" && !isWebOS,
})
