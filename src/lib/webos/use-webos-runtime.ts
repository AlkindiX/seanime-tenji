/** Native builds have nothing to set up; see use-webos-runtime.web.ts. */
export function useWebOSRuntime() {}

/** The Magic Remote pointer only exists on webOS; native TV remotes have none. */
export function usePointerActivity(_callback: () => void) {}
