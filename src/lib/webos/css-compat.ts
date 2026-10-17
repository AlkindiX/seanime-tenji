/**
 * Rewrites of CSS that react-native-web generates at runtime (so the build's
 * lightningcss pass never sees it) for engines that drop it.
 */

/**
 * `overflow: clip` needs Chromium 90; webOS 6 (79) and webOS 22 (87) drop
 * the declaration, which leaves `numberOfLines` text unclamped and drawn over
 * what follows it. `hidden` clips the same box.
 */
export function lowerRuntimeRule(rule: string, supportsOverflowClip: boolean) {
    if (supportsOverflowClip || !rule.includes("clip")) return rule
    return rule.replace(/(^|[{;\s])(overflow(?:-x|-y)?\s*:\s*)clip\b/g, "$1$2hidden")
}

export function supportsOverflowClip() {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("overflow", "clip")
}
