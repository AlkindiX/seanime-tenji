import assert from "node:assert/strict"
import test from "node:test"
import { lowerRuntimeRule } from "../src/lib/webos/css-compat.ts"

test("overflow: clip becomes hidden where the engine lacks it", () => {
    // react-native-web's multi-line numberOfLines rule
    assert.equal(lowerRuntimeRule(".r-1qsk4np{overflow:clip;}", false), ".r-1qsk4np{overflow:hidden;}")
    assert.equal(lowerRuntimeRule(".a{display:-webkit-box; overflow-x: clip;overflow-y:clip}", false), ".a{display:-webkit-box; overflow-x: hidden;overflow-y:hidden}")
    assert.equal(lowerRuntimeRule("@media all{.b{overflow:clip}}", false), "@media all{.b{overflow:hidden}}")
})

test("other rules, and engines with overflow: clip, are left alone", () => {
    assert.equal(lowerRuntimeRule(".r-1qsk4np{overflow:clip;}", true), ".r-1qsk4np{overflow:clip;}")
    assert.equal(lowerRuntimeRule(".c{clip-path:inset(0);overflow:hidden}", false), ".c{clip-path:inset(0);overflow:hidden}")
    assert.equal(lowerRuntimeRule(".d{overflow-clip-margin:4px}", false), ".d{overflow-clip-margin:4px}")
    assert.equal(lowerRuntimeRule(".e{text-overflow:clip}", false), ".e{text-overflow:clip}")
})
