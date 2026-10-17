// webOS keeps the screen on while video plays; the browser wake-lock API
// expo-keep-awake uses on web is missing or unreliable on TVs.
export const ExpoKeepAwakeTag = "ExpoKeepAwakeDefaultTag"

export async function isAvailableAsync() {
    return false
}

export function useKeepAwake(_tag?: string) {}

export async function activateKeepAwake(_tag?: string) {}

export async function activateKeepAwakeAsync(_tag?: string) {}

export async function deactivateKeepAwake(_tag?: string) {}

export function addListener() {
    return { remove() {} }
}
