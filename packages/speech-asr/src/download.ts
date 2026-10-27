import { createHash } from "node:crypto"
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import {
  GIGAAM_DIR,
  GIGAAM_TAR,
  GIGAAM_TAR_URL,
  ensureCacheDirs,
  gigaamFiles,
} from "./paths.ts"

const ENCODER_SHA256 =
  "369f35a71bf288d3b8e0391fabd8dba5f2314088d440bca474056b7b4b6e66bf"

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Не удалось скачать ${url}: ${response.status}`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()))
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")))
  })
}

export async function ensureGigaamModel(): Promise<string> {
  ensureCacheDirs()
  const files = gigaamFiles()
  if (existsSync(files.encoder) && existsSync(files.decoder) && existsSync(files.joiner) && existsSync(files.tokens)) {
    const digest = await sha256File(files.encoder)
    if (digest !== ENCODER_SHA256) {
      throw new Error(`SHA-256 энкодера GigaAM не совпал: ${digest}`)
    }
    return GIGAAM_DIR
  }
  if (!existsSync(GIGAAM_TAR) || statSync(GIGAAM_TAR).size === 0) {
    await download(GIGAAM_TAR_URL, GIGAAM_TAR)
  }
  execFileSync("tar", ["-xjf", GIGAAM_TAR, "-C", join(GIGAAM_DIR, "..")], {
    stdio: "inherit",
  })
  const digest = await sha256File(files.encoder)
  if (digest !== ENCODER_SHA256) {
    throw new Error(`SHA-256 энкодера GigaAM не совпал после распаковки: ${digest}`)
  }
  return GIGAAM_DIR
}
