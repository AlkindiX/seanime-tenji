/**
 * Online streams on the web (LG webOS) build go through the Seanime server's
 * proxy. A packaged webOS app sends `Origin: null` and can't set Referer, so
 * hosts that need a Referer, or don't answer CORS, refuse it directly. The
 * proxy adds the source's headers, rewrites HLS playlists so every segment
 * also goes through it, and answers with `Access-Control-Allow-Origin: *`.
 * Kept free of React Native so the tests can load it.
 */

export const PROXY_ENDPOINT = "/api/v1/proxy"

/**
 * The proxy URL for `url`. `sign` adds the HMAC token for the proxy
 * endpoint; the proxy carries it over to the URLs in a playlist it rewrites,
 * so no request needs a header (and none needs a CORS preflight).
 */
export function proxiedUrl(
    serverUrl: string,
    url: string,
    headers: Record<string, string> | undefined,
    sign: (url: string, endpoint: string) => string,
): string {
    const server = serverUrl.replace(/\/+$/, "")
    if (!/^https?:\/\//i.test(url) || url.startsWith(`${server}/`)) return url
    const headerParam = headers && Object.keys(headers).length > 0
        ? `&headers=${encodeURIComponent(JSON.stringify(headers))}`
        : ""
    return sign(`${server}${PROXY_ENDPOINT}?url=${encodeURIComponent(url)}${headerParam}`, PROXY_ENDPOINT)
}
