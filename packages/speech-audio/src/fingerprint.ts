import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { fingerprintKey } from "../../speech-core/src/index.ts"

export interface FileFingerprint {
  size: number
  sha256: string
  key: string
}

/** Полный SHA-256 потоком (D14). */
export function fingerprintFile(path: string): Promise<FileFingerprint> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    let size = 0
    createReadStream(path)
      .on("data", (chunk: Buffer | string) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk
        size += buf.byteLength
        hash.update(buf)
      })
      .on("error", reject)
      .on("end", () => {
        const sha256 = hash.digest("hex")
        resolve({ size, sha256, key: fingerprintKey(size, sha256) })
      })
  })
}

export function fingerprintBuffer(bytes: Buffer): FileFingerprint {
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  return {
    size: bytes.byteLength,
    sha256,
    key: fingerprintKey(bytes.byteLength, sha256),
  }
}
