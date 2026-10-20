/**
 * Builds `next` but keeps `previous`'s object for every key whose fields are
 * unchanged (compared one level deep, by identity).
 *
 * Per-media records rebuilt from a refetched collection are all new objects,
 * so every card reading its own entry re-rendered on each refetch (on webOS:
 * the whole library on every return to it). With this, only cards whose data
 * changed do. Returns `previous` itself when nothing changed at all.
 */
export function reuseEqualEntries<T extends object>(
    previous: Readonly<Record<string, T>> | undefined,
    next: Record<string, T>,
): Record<string, T> {
    if (!previous) return next

    let changed = Object.keys(previous).length !== Object.keys(next).length
    for (const key of Object.keys(next)) {
        const before = previous[key]
        if (before !== undefined && shallowEqual(before, next[key])) {
            next[key] = before
        } else {
            changed = true
        }
    }
    return changed ? next : previous as Record<string, T>
}

function shallowEqual(a: object, b: object) {
    if (a === b) return true
    const keysA = Object.keys(a)
    if (keysA.length !== Object.keys(b).length) return false
    for (const key of keysA) {
        if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
    }
    return true
}
