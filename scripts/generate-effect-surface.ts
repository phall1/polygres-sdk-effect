import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { contextBindings } from "../src/internal/ContextBindings.js"

interface Method {
  readonly public_name: string
  readonly operation_id: string
  readonly method: string
  readonly path: string
}

const baseMethods: ReadonlyArray<readonly [string, string, string, string]> = [
  ["connectionInfo", "runtime_connection_info_get", "GET", "/v1/connection-info"],
  ["readiness", "runtime_retrieval_readiness", "GET", "/v1/retrieval/readiness"],
  ["graph.expand", "runtime_graph_expand", "POST", "/v1/graph/expand"],
  ["graph.neighborhood", "runtime_graph_neighborhood", "POST", "/v1/graph/neighborhood"],
  ["graph.related", "runtime_graph_related", "POST", "/v1/graph/related"],
  ["graph.path", "runtime_graph_path", "POST", "/v1/graph/path"],
  ["graph.connection", "runtime_graph_connection", "POST", "/v1/graph/connection"],
  ["vector.search", "runtime_vector_search", "POST", "/v1/vector/search"],
  ["vector.similarTo", "runtime_vector_similar_to", "POST", "/v1/vector/similar-to"],
  ["text.tsvector", "runtime_text_tsvector", "POST", "/v1/text/tsvector"],
  ["text.fuzzy", "runtime_text_fuzzy", "POST", "/v1/text/fuzzy"],
  ["hybrid.graphFirst", "runtime_hybrid_graph_first", "POST", "/v1/hybrid/graph-first"],
  ["hybrid.vectorFirst", "runtime_hybrid_vector_first", "POST", "/v1/hybrid/vector-first"],
  ["hybrid.joint", "runtime_hybrid_joint", "POST", "/v1/hybrid/joint"],
  ["rows.insert", "runtime_write_row", "POST", "/v1/tables/{schema_name}/{table_name}/rows"],
  ["rows.upsert", "runtime_write_row", "POST", "/v1/tables/{schema_name}/{table_name}/rows"],
  ["rows.ignore", "runtime_write_row", "POST", "/v1/tables/{schema_name}/{table_name}/rows"],
  ["rows.validate", "runtime_validate_row_write", "POST", "/v1/tables/{schema_name}/{table_name}/rows/validate"],
]
const methods: Array<Method> = baseMethods.map(([public_name, operation_id, method, path]) => ({
  public_name,
  operation_id,
  method,
  path,
}))

for (const binding of contextBindings) {
  if (binding.kind === "local") continue
  methods.push({
    public_name: `context.${binding.publicName}`,
    operation_id: binding.operationId,
    method: binding.method,
    path: binding.path,
  })
}

const contextMethods = methods.filter(({ public_name }) => public_name.startsWith("context."))
const rowMethods = methods.filter(({ public_name }) => public_name.startsWith("rows."))
const retrievalMethods = methods.length - contextMethods.length - rowMethods.length
const uniqueOperations = new Set(methods.map(({ operation_id }) => operation_id)).size
const localContextMethods = contextBindings.filter(({ kind }) => kind === "local").length
if (
  methods.length !== 102 ||
  retrievalMethods !== 14 ||
  rowMethods.length !== 4 ||
  contextMethods.length !== 84 ||
  uniqueOperations !== 91 ||
  contextBindings.length !== 96 ||
  localContextMethods !== 12
) {
  throw new Error("Effect surface totals differ from the reviewed Runtime baseline")
}

export const effectSurface = {
  api_family: "v1",
  default_api_version: "2026-08-04",
  upstream_sdk_version: "0.4.1",
  methods,
} as const

if (import.meta.main) {
  const outputUrl = new URL("../contracts/effect-sdk-v1.surface.json", import.meta.url)
  await writeFile(outputUrl, `${JSON.stringify(effectSurface, null, 2)}\n`)
  console.log(`Generated ${methods.length} public HTTP methods at ${fileURLToPath(outputUrl)}`)
}
