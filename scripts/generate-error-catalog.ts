import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { type ErrorCatalog, parsePythonErrorCatalog } from "./parse-error-catalog.js"

const outputUrl = new URL("../src/internal/ErrorCatalog.ts", import.meta.url)

export const renderErrorCatalog = (
  catalog: ErrorCatalog,
): string => `// Generated from the pinned official Python SDK error catalog. Do not edit by hand.
export type RetryClass =
  | "after_delay"
  | "after_user_action"
  | "bounded_retry"
  | "dependency_retry"
  | "never"
  | "user_retry"

export type Descriptor = readonly [
  status: number,
  message: string,
  safe: ReadonlyArray<string>,
  variants: Readonly<Record<string, readonly [message: string, status: number]>>,
  retryClass: RetryClass,
]

export const catalog: Readonly<Record<string, Descriptor>> = ${JSON.stringify(catalog, null, 2)}
`

export const formatErrorCatalog = async (catalog: ErrorCatalog): Promise<string> => {
  const formatter = Bun.spawn(["bunx", "biome", "format", "--stdin-file-path", fileURLToPath(outputUrl)], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  formatter.stdin.write(renderErrorCatalog(catalog))
  formatter.stdin.end()
  const [status, output, error] = await Promise.all([
    formatter.exited,
    new Response(formatter.stdout).text(),
    new Response(formatter.stderr).text(),
  ])
  if (status !== 0) throw new Error(`Failed to format the generated error catalog: ${error.trim()}`)
  return output
}

if (import.meta.main) {
  const source = await readFile(new URL("../contracts/python-sdk-v1.errors.py", import.meta.url), "utf8")
  const catalog = parsePythonErrorCatalog(source)
  await writeFile(outputUrl, await formatErrorCatalog(catalog))
  console.log(`Generated ${Object.keys(catalog).length} errors at ${fileURLToPath(outputUrl)}`)
}
