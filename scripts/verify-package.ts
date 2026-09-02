import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const directory = await mkdtemp(join(tmpdir(), "polygres-sdk-effect-"))
let archivePath: string | undefined

try {
  const packageJson = await Bun.file(join(root, "package.json")).json()
  const packed = Bun.spawnSync(["bun", "pm", "pack", "--quiet"], { cwd: root })
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString())
  const archive = packed.stdout.toString().trim().split("\n").at(-1)
  if (!archive) throw new Error("bun pm pack did not return an archive")
  archivePath = join(root, archive)

  await Bun.write(
    join(directory, "consumer.ts"),
    `import type { Effect } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { Context, ContextQuery, Operation, Polygres, PolygresError, Rows, Vector } from "polygres-sdk-effect"
if (!Polygres.Client || !Polygres.make || !Context.Collection || !ContextQuery.QueryPlan || !Operation.Value || !Rows.WriteResult || !Vector.SearchInput) throw new Error("missing public exports")
if (Polygres.VERSION !== ${JSON.stringify(packageJson.version)}) throw new Error("version mismatch")
const client: Effect.Effect<Polygres.Service, PolygresError.Configuration, HttpClient.HttpClient> = Polygres.make({
  apiKey: "poly_live_0123456789abcdef0123456789abcdef",
  projectId: "p0123456789abcdef0123456"
})
const contextMethod: keyof Polygres.Service["context"] = "createCollection"
void client
void contextMethod
console.log(Polygres.VERSION)
`,
  )
  await Bun.write(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ESNext",
        lib: ["ESNext", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: false,
      },
      include: ["consumer.ts"],
    }),
  )

  for (const command of [
    ["bun", "init", "-y"],
    ["bun", "add", archivePath, "effect@4.0.0-rc.112"],
    [join(root, "node_modules", ".bin", "tsc"), "--project", "tsconfig.json"],
    [
      "bun",
      "-e",
      'import { Context, ContextQuery, Graph, Operation, Page, Polygres, PolygresError, Rows, Runtime, Vector } from "polygres-sdk-effect"; if (!Polygres.Client || !Polygres.make || !Context.Collection || !ContextQuery.QueryPlan || !Graph.PathInput || !Operation.Value || !Page.Value || !PolygresError.InvalidInput || !Rows.WriteResult || !Runtime.Readiness || !Vector.SearchInput) process.exit(1)',
    ],
    [
      "node",
      "--input-type=module",
      "-e",
      'const sdk = await import("polygres-sdk-effect"); if (!sdk.Context?.Collection || !sdk.ContextQuery?.QueryPlan || !sdk.Operation?.Value || !sdk.Polygres?.Client || !sdk.Rows?.WriteResult || !sdk.Vector?.SearchInput) process.exit(1)',
    ],
    ["bun", "build", "./consumer.ts", "--target", "browser", "--outdir", "./browser-dist"],
    ["node", "./browser-dist/consumer.js"],
  ]) {
    const result = Bun.spawnSync(command, { cwd: directory })
    if (result.exitCode !== 0) {
      throw new Error(`${command.join(" ")} failed:\n${result.stdout.toString()}${result.stderr.toString()}`)
    }
  }
  console.log("Verified packed declarations, Bun/Node imports, and an executable web-standard consumer bundle.")
} finally {
  await rm(directory, { recursive: true, force: true })
  if (archivePath !== undefined) await rm(archivePath, { force: true })
}
