import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { catalog } from "../src/internal/ErrorCatalog.js"
import { API_VERSION } from "../src/Polygres.js"
import { readLocal, validateLock, validateSurface, withContractLock } from "./refresh-contract.js"

const parseJson = (bytes: Uint8Array, name: string): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new Error(`${name} is not valid JSON`, { cause })
  }
}

const main = async (): Promise<void> => {
  const root = join(import.meta.dir, "..")
  const [surfaceBytes, lockBytes] = await Promise.all([
    readFile(join(root, "contracts", "effect-sdk-v1.surface.json")),
    readFile(join(root, "contracts", "upstream-v1.lock.json")),
  ])
  const surface = validateSurface(parseJson(surfaceBytes, "effect-sdk-v1.surface.json"))
  const lock = validateLock(parseJson(lockBytes, "upstream-v1.lock.json"))
  if (surface.default_api_version !== API_VERSION) {
    throw new Error(`Runtime API version mismatch: source=${API_VERSION} surface=${surface.default_api_version}`)
  }
  const bundle = await withContractLock(root, () => readLocal(root, surface, lock))
  if (!isDeepStrictEqual(bundle.errorCatalog, catalog)) {
    throw new Error("Private error catalog implementation differs from the pinned Python source")
  }
  console.log(
    `Verified ${surface.methods.length} methods and local contract integrity for recorded commit ${lock.resolved_commit.slice(0, 12)}.`,
  )
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
})
