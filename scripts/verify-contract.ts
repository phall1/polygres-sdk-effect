import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { catalog } from "../src/internal/ErrorCatalog.js"
import { API_VERSION } from "../src/Polygres.js"
import { effectSurface } from "./generate-effect-surface.js"
import { formatErrorCatalog } from "./generate-error-catalog.js"
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
  const [surfaceBytes, lockBytes, catalogSource] = await Promise.all([
    readFile(join(root, "contracts", "effect-sdk-v1.surface.json")),
    readFile(join(root, "contracts", "upstream-v1.lock.json")),
    readFile(join(root, "src", "internal", "ErrorCatalog.ts"), "utf8"),
  ])
  const expectedSurface = `${JSON.stringify(effectSurface, null, 2)}\n`
  if (new TextDecoder().decode(surfaceBytes) !== expectedSurface) {
    throw new Error(
      "Effect surface bytes differ from the reviewed SDK binding registries; run bun run contracts:surface",
    )
  }
  const surface = validateSurface(parseJson(surfaceBytes, "effect-sdk-v1.surface.json"))
  if (!isDeepStrictEqual(surface, validateSurface(effectSurface))) {
    throw new Error("Effect surface differs from the reviewed SDK binding registries; run bun run contracts:surface")
  }
  const lock = validateLock(parseJson(lockBytes, "upstream-v1.lock.json"))
  if (surface.default_api_version !== API_VERSION) {
    throw new Error(`Runtime API version mismatch: source=${API_VERSION} surface=${surface.default_api_version}`)
  }
  const bundle = await withContractLock(root, () => readLocal(root, surface, lock))
  if (catalogSource !== (await formatErrorCatalog(bundle.errorCatalog))) {
    throw new Error("Private error catalog bytes differ from the deterministic generator; run bun run catalog:generate")
  }
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
