import assert from "node:assert/strict"
import test from "node:test"
import { proxiedUrl } from "../src/lib/player/online-proxy.ts"

const sign = (url: string, endpoint: string) => `${url}&token=signed:${endpoint}`

test("online URLs go through the server's proxy with their headers and a token", () => {
    const url = proxiedUrl("http://tv-server:43211/", "https://cdn.example/a b/master.m3u8?x=1", { Referer: "https://site.example/" }, sign)
    const parsed = new URL(url)

    assert.equal(parsed.origin + parsed.pathname, "http://tv-server:43211/api/v1/proxy")
    assert.equal(parsed.searchParams.get("url"), "https://cdn.example/a b/master.m3u8?x=1")
    assert.deepEqual(JSON.parse(parsed.searchParams.get("headers")!), { Referer: "https://site.example/" })
    assert.equal(parsed.searchParams.get("token"), "signed:/api/v1/proxy")
})

test("sources without headers are proxied too, and server or non-http URLs are left alone", () => {
    const url = new URL(proxiedUrl("http://tv-server:43211", "https://cdn.example/sub.vtt", {}, sign))
    assert.equal(url.searchParams.get("headers"), null)
    assert.equal(url.searchParams.get("url"), "https://cdn.example/sub.vtt")

    assert.equal(proxiedUrl("http://tv-server:43211", "http://tv-server:43211/api/v1/x", undefined, sign), "http://tv-server:43211/api/v1/x")
    assert.equal(proxiedUrl("http://tv-server:43211", "file:///sub.srt", undefined, sign), "file:///sub.srt")
})
