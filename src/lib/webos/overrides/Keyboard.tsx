import "../install"
import { addKeyboardListener, emitKeyboardEvent } from "../webos-platform"

type KeyboardEventName = Parameters<typeof addKeyboardListener>[0]

/** Keyboard events come from the webOS on-screen keyboard (see webos-platform). */
const Keyboard = {
    addListener(eventName: KeyboardEventName, listener: Parameters<typeof addKeyboardListener>[1]) {
        return { remove: addKeyboardListener(eventName, listener) }
    },
    removeAllListeners() {},
    removeListener() {},
    dismiss() {
        const active = document.activeElement
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
            emitKeyboardEvent("keyboardDidHide")
            active.blur()
        }
    },
    isVisible() {
        return false
    },
    metrics() {
        return undefined
    },
    scheduleLayoutAnimation() {},
}

export default Keyboard
