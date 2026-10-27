import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { describe, it } from "node:test"
import { GIGAAM_DIR } from "../src/paths.ts"
import { probeGigaamWasm, writeProbeResult } from "../src/probe.ts"

describe("wasm probe D6", () => {
  it("грузит GigaAM в ORT WASM и гоняет энкодер", async () => {
    assert.equal(existsSync(GIGAAM_DIR), true)
    const result = await probeGigaamWasm()
    writeProbeResult(result)
    assert.equal(result.ok, true)
    assert.ok(result.loadMs > 0)
    assert.ok((result.encoderRunMs ?? 0) > 0)
    assert.deepEqual(result.inputs.encoder, ["audio_signal", "length"])
    assert.ok(result.encoderOutputDims)
  })
})
