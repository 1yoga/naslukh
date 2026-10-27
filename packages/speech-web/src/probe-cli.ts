import { probeGigaamWasm, writeProbeResult } from "./probe.ts"

const result = await probeGigaamWasm()
const path = writeProbeResult(result)
console.log(JSON.stringify({ ...result, wrote: path }, null, 2))
if (!result.ok) process.exitCode = 1
