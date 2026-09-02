import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const directory = await mkdtemp(join(tmpdir(), "polygres-sdk-effect-"))
let archivePath: string | undefined

try {
  const packed = Bun.spawnSync(["bun", "pm", "pack", "--quiet"], { cwd: root })
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString())
  const archive = packed.stdout.toString().trim().split("\n").at(-1)
  if (!archive) throw new Error("bun pm pack did not return an archive")
  archivePath = join(root, archive)

  for (const command of [
    ["bun", "init", "-y"],
    ["bun", "add", archivePath, "effect@4.0.0-rc.112"],
    [
      "bun",
      "-e",
      'import { PolygresClient, paginate, Polygres } from "polygres-sdk-effect"; if (!PolygresClient || !paginate || !Polygres.make) process.exit(1)',
    ],
  ]) {
    const result = Bun.spawnSync(command, { cwd: directory, stdout: "ignore" })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  console.log("Verified packed package installation and ESM imports.")
} finally {
  await rm(directory, { recursive: true, force: true })
  if (archivePath !== undefined) await rm(archivePath, { force: true })
}
