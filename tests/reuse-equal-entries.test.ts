import assert from "node:assert/strict"
import test from "node:test"
import { reuseEqualEntries } from "../src/lib/utils/reuse-equal-entries.ts"

test("unchanged entries keep their objects, changed ones are replaced", () => {
    const library = { files: 3 }
    const previous = {
        "1": { status: "CURRENT", progress: 2, libraryData: library },
        "2": { status: "COMPLETED", progress: 12, libraryData: library },
    }
    const next = {
        "1": { status: "CURRENT", progress: 2, libraryData: library },
        "2": { status: "COMPLETED", progress: 13, libraryData: library },
    }
    const result = reuseEqualEntries(previous, next)
    assert.equal(result["1"], previous["1"])
    assert.notEqual(result["2"], previous["2"])
    assert.equal(result["2"].progress, 13)
})

test("a refetch that changed nothing returns the previous record itself", () => {
    const previous = { "1": { progress: 1 }, "2": { progress: 2 } }
    const result = reuseEqualEntries(previous, { "1": { progress: 1 }, "2": { progress: 2 } })
    assert.equal(result, previous)
})

test("added and removed media count as a change", () => {
    const previous = { "1": { progress: 1 } }
    assert.notEqual(reuseEqualEntries(previous, { "1": { progress: 1 }, "2": { progress: 0 } }), previous)
    assert.notEqual(reuseEqualEntries({ "1": { progress: 1 }, "2": { progress: 0 } }, { "1": { progress: 1 } }), previous)
})

test("nested objects are compared by identity, as the query cache shares unchanged ones", () => {
    const previous = { "1": { libraryData: { files: 3 } } }
    // Same content, new object: a real change in the cache would look like this.
    const result = reuseEqualEntries(previous, { "1": { libraryData: { files: 3 } } })
    assert.notEqual(result["1"], previous["1"])
})

test("without a previous record the next one is used as it is", () => {
    const next = { "1": { progress: 1 } }
    assert.equal(reuseEqualEntries(undefined, next), next)
})
