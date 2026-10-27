import { createWriteStream, existsSync, statSync, writeFileSync } from "node:fs"
import { ensureCacheDirs } from "./paths.ts"

export async function ensureFile(path: string, url: string): Promise<string> {
  ensureCacheDirs()
  if (existsSync(path) && statSync(path).size > 0) return path
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Не удалось скачать ${url}: ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(path, bytes)
  return path
}
