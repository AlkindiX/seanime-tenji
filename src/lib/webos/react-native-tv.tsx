/**
 * `react-native` for the webOS build (wired up in metro.config.js).
 *
 * react-native-web plus the react-native-tvos APIs the TV interface uses.
 * Components are re-exported from their deep paths so uniwind's className
 * wrappers still apply.
 */
import "./install"

export * from "react-native-web"

export { default as ActivityIndicator } from "react-native-web/dist/exports/ActivityIndicator"
export { default as Button } from "react-native-web/dist/exports/Button"
export { default as FlatList } from "react-native-web/dist/exports/FlatList"
export { default as Image } from "react-native-web/dist/exports/Image"
export { default as ImageBackground } from "react-native-web/dist/exports/ImageBackground"
export { default as InputAccessoryView } from "react-native-web/dist/exports/InputAccessoryView"
export { default as KeyboardAvoidingView } from "react-native-web/dist/exports/KeyboardAvoidingView"
export { default as RefreshControl } from "react-native-web/dist/exports/RefreshControl"
export { default as SafeAreaView } from "react-native-web/dist/exports/SafeAreaView"
export { default as ScrollView } from "react-native-web/dist/exports/ScrollView"
export { default as SectionList } from "react-native-web/dist/exports/SectionList"
export { default as Switch } from "react-native-web/dist/exports/Switch"
export { default as Text } from "react-native-web/dist/exports/Text"
export { default as TextInput } from "react-native-web/dist/exports/TextInput"
export { default as TouchableNativeFeedback } from "react-native-web/dist/exports/TouchableNativeFeedback"
export { default as TouchableWithoutFeedback } from "react-native-web/dist/exports/TouchableWithoutFeedback"
export { default as View } from "react-native-web/dist/exports/View"
export { default as VirtualizedList } from "react-native-web/dist/exports/VirtualizedList"

export { default as BackHandler } from "./overrides/BackHandler"
export { default as Keyboard } from "./overrides/Keyboard"
export { default as Modal } from "./overrides/Modal"
export { default as Platform } from "./overrides/Platform"
export { default as Pressable } from "./overrides/Pressable"
export { default as TouchableHighlight } from "./overrides/TouchableHighlight"
export { default as TouchableOpacity } from "./overrides/TouchableOpacity"

export { TVFocusGuideView } from "./tv-focus-guide"
export { TVEventControl, TVEventHandler, useTVEventHandler } from "./tv-events"
