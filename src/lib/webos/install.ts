import { installRemote } from "./remote"
import { focusElement } from "./spatial-navigation"

declare global {
    interface HTMLElement {
        requestTVFocus?: () => void
    }
}

// The TV components draw their own focus state.
const TV_CSS = `
*:focus { outline: none; }
* { -webkit-tap-highlight-color: transparent; }
html, body { background-color: #070707; overflow: hidden; }
::-webkit-scrollbar { display: none; }
`

/**
 * Packaged webOS apps run from file://, where Chromium only lets
 * pushState/replaceState change the query and hash. The router keeps its own
 * history, so entries are still recorded but the document URL stays put.
 */
function keepDocumentUrl() {
    for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method].bind(history)
        history[method] = (data: unknown, unused: string) => original(data, unused)
    }
}

if (typeof window !== "undefined") {
    installRemote()
    if (window.location.protocol === "file:") keepDocumentUrl()

    const style = document.createElement("style")
    style.setAttribute("data-webos", "tv")
    style.textContent = TV_CSS
    document.head.appendChild(style)

    // react-native-tvos refs expose requestTVFocus(); react-native-web refs are DOM nodes.
    if (!HTMLElement.prototype.requestTVFocus) {
        HTMLElement.prototype.requestTVFocus = function requestTVFocus(this: HTMLElement) {
            focusElement(this)
        }
    }
}
