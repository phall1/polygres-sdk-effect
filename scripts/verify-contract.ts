import surface from "../contracts/effect-sdk-v1.surface.json"
import upstream from "../contracts/python-sdk-v1.methods.json"
import openapi from "../contracts/runtime-v1.openapi.json"

type Operation = { readonly method: string; readonly path: string }

const upstreamOperations = new Set(
  upstream.methods.flatMap((entry) => entry.operations.map((operation) => `${operation.method} ${operation.path}`)),
)

const failures: string[] = []
for (const operation of surface.methods as ReadonlyArray<Operation & { readonly public_name: string }>) {
  const key = `${operation.method} ${operation.path}`
  const path = openapi.paths[operation.path as keyof typeof openapi.paths] as Record<string, unknown> | undefined
  if (path?.[operation.method.toLowerCase()] === undefined) {
    failures.push(`${operation.public_name}: ${key} is absent from runtime-v1.openapi.json`)
  }
  if (!upstreamOperations.has(key)) {
    failures.push(`${operation.public_name}: ${key} is absent from the official Python SDK surface`)
  }
}

if (surface.default_api_version !== upstream.default_api_version) {
  failures.push(`API version mismatch: Effect=${surface.default_api_version}, upstream=${upstream.default_api_version}`)
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(`Verified ${surface.methods.length} methods against the Runtime OpenAPI and official SDK manifests.`)
