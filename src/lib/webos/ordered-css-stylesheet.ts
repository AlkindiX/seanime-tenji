import uniwindCreateOrderedCSSStyleSheet from "uniwind/components/createOrderedCSSStyleSheet"
import { lowerRuntimeRule, supportsOverflowClip } from "./css-compat"

type RuleSheet = {
    readonly cssRules: ArrayLike<unknown>
    insertRule: (rule: string, index?: number) => number
}

/**
 * react-native-web's stylesheet for the webOS build (wired up in metro.config.js).
 *
 * Uniwind keeps react-native-web's reset rules in `@layer rnw` so Tailwind
 * classes beat them while `style` props beat Tailwind. Chromium before 99
 * (webOS 23 and older) has no cascade layers and rejects that rule, so the
 * same order is produced with stylesheet order: resets in a sheet before the
 * app CSS, react-native-web's other rules in a sheet after it. Those engines
 * also lack `overflow: clip`, which rules are rewritten for (css-compat.ts).
 */
export default function createOrderedCSSStyleSheet(sheet: CSSStyleSheet | null) {
    if (sheet === null || typeof CSSLayerBlockRule !== "undefined") {
        return uniwindCreateOrderedCSSStyleSheet(sheet)
    }

    const head = document.head
    let target: CSSStyleSheet = sheet
    const node = sheet.ownerNode
    if (node instanceof HTMLStyleElement && node.parentNode === head && sheet.cssRules.length === 0) {
        // Moving a <style> re-creates its (still empty) sheet.
        head.appendChild(node)
        target = node.sheet ?? sheet
    }

    const base = document.createElement("style")
    base.setAttribute("data-rnw-base", "")
    head.insertBefore(base, head.firstChild)
    const baseSheet = base.sheet!
    const clip = supportsOverflowClip()

    const layer: RuleSheet = {
        get cssRules() {
            return baseSheet.cssRules
        },
        insertRule: (rule, index) => baseSheet.insertRule(lowerRuntimeRule(rule, clip), index),
    }

    // Looks like a sheet whose first rule is the `@layer rnw` block.
    const facade: RuleSheet = {
        get cssRules() {
            return [layer, ...Array.from(target.cssRules)]
        },
        insertRule(rule, index = 0) {
            if (rule.trim().startsWith("@layer")) return 0
            return target.insertRule(lowerRuntimeRule(rule, clip), Math.max(0, index - 1)) + 1
        },
    }

    return uniwindCreateOrderedCSSStyleSheet(facade as unknown as CSSStyleSheet)
}
