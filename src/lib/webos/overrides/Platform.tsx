import Platform from "react-native-web/dist/exports/Platform"

// The webOS build renders the TV interface; code checks `Platform.isTV` for it.
// Mutated in place so modules holding the react-native-web object agree.
Object.assign(Platform, { isTV: true, isTVOS: false })

export default Platform
