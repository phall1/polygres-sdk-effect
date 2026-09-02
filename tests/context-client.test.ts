import { expect, test } from "bun:test"
import { Duration, Effect, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import { type ContextOperationBinding, contextBindings } from "../src/internal/ContextBindings.js"
import { type ContextService, make } from "../src/internal/ContextClient.js"
import type * as HttpTransport from "../src/internal/HttpTransport.js"
import type * as Operation from "../src/Operation.js"
import * as PolygresError from "../src/PolygresError.js"
import { availableCapabilities } from "./context-fixtures.js"

const collectionId = "00000000-0000-0000-0000-000000000001"
const operationId = "00000000-0000-0000-0000-000000000002"
const idempotencyKey = "context-client-test-key"
const source = { mode: "existing", schemaName: "public", tableName: "documents", sourceKeyColumn: "id" }
const vector = { columnName: "embedding", dimensions: 2, metric: "cosine" }
const start = { schema: "public", table: "accounts", id: "acct-1" }

interface ManifestMethod {
  readonly public_name: string
  readonly operations: ReadonlyArray<{ readonly success_responses: Readonly<Record<string, string>> }>
}

const manifest = JSON.parse(
  await Bun.file(new URL("../contracts/python-sdk-v1.methods.json", import.meta.url)).text(),
) as { readonly methods: ReadonlyArray<ManifestMethod> }
const manifestMethods = new Map(
  manifest.methods
    .filter(({ public_name }) => public_name.startsWith("project.context."))
    .map((method) => [
      method.public_name
        .slice("project.context.".length)
        .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      method,
    ]),
)

const transportError = () =>
  new PolygresError.Transport({
    operation: "test",
    reason: "request",
    message: "stop after capture",
    details: {},
  })

const capturingTransport = (requests: HttpTransport.Request[]): HttpTransport.Service => ({
  request: (request) => {
    requests.push(request)
    return Effect.fail(transportError())
  },
  requestWithMetadata: (request) => {
    requests.push(request)
    return Effect.fail(transportError())
  },
})

const collectionCreate = { name: "support", source, vector }

const inputs: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  acknowledgeOnboarding: { idempotencyKey },
  addFilterColumn: { collectionId, key: "tenant", column: "tenant_id", idempotencyKey },
  addJsonbFilterPath: { collectionId, key: "topic", column: "metadata", path: ["topic"], idempotencyKey },
  addVector: { collectionId, columnName: "embedding_v2", dimensions: 2, idempotencyKey },
  backfillPoints: { collection: "support" },
  bulkDeletePoints: { collection: "support", sourceKeys: ["one"] },
  bulkUpsertPoints: { collection: "support", sourceKeys: ["one"] },
  cancelOperation: { operationId, idempotencyKey },
  candidateSearch: { collection: "support", embedding: [0.1], candidatePointIds: [1] },
  clearPayload: { collection: "support", sourceKeys: ["one"] },
  collectionAliases: {},
  collectionInfo: { collectionName: "support" },
  collectionLimits: { collectionName: "support" },
  collectionVectors: { collectionName: "support" },
  configureCollectionLimits: { collectionName: "support", strictMode: true },
  configureVector: {
    collectionName: "support",
    vectorName: "embedding",
    hnswOptions: {},
    quantizationOptions: {},
    status: "ready",
  },
  count: { collection: "support" },
  createCollection: { ...collectionCreate, idempotencyKey },
  createCollectionAlias: { aliasName: "support", targetCollectionName: "support_v2" },
  createEmbeddingMigration: {
    collectionName: "support",
    sourceModelName: "embed",
    sourceModelVersion: "1",
    targetModelName: "embed",
    targetModelVersion: "2",
    totalPoints: 10,
  },
  deleteCollection: { collectionId, confirmCollectionId: collectionId, idempotencyKey },
  deletePayload: { collection: "support", sourceKeys: ["one"], payloadKeys: ["title"] },
  deletePoints: { collectionId, sourceKeys: ["one"], idempotencyKey },
  discover: { collection: "support", contextPointIds: [1] },
  discoverSources: {},
  dismissOnboarding: { idempotencyKey },
  dropCollection: { collectionId, confirmCollectionId: collectionId, idempotencyKey },
  dropCollectionAlias: { aliasName: "support" },
  embeddingMigrations: { collectionName: "support" },
  estimateIndexMemory: { collectionName: "support", indexName: "support_hnsw" },
  evaluateOnboarding: {},
  executeQuery: { collection: "support", plan: { kind: "lookup", pointIds: [1] } },
  explain: { collection: "support", textColumn: "content" },
  explore: { collection: "support", contextPointIds: [1] },
  facet: { collection: "support", field: "tenant" },
  facets: { collection: "support", field: "tenant" },
  getCapabilities: {},
  getCollection: { collectionId },
  getCollectionDiagnostics: { collectionId },
  getCollectionStatus: { collectionId },
  getOnboarding: {},
  getOperation: { operationId },
  getPointStatus: { collectionId },
  graphFirst: { collection: "support", embedding: [0.1], start },
  groupedSearch: { collection: "support", embedding: [0.1], groupBy: "tenant" },
  indexAdvisor: { collectionName: "support" },
  indexDiagnostics: { collectionName: "support", indexName: "support_hnsw" },
  indexStatus: { collectionName: "support", indexName: "support_hnsw" },
  joint: { collection: "support", embedding: [0.1] },
  listCollections: { status: "ready", limit: 25, cursor: "collections-cursor" },
  listFilters: { collectionId },
  listOperations: { collectionId, kind: "points_reconcile", status: "running", limit: 25, cursor: "operations-cursor" },
  modelVersions: { collectionName: "support" },
  optimizationStatus: { collectionName: "support" },
  preflight: collectionCreate,
  query: { collection: "support", embedding: [0.1], query: "refund" },
  queryCohortStats: { collectionName: "support" },
  queryExecutionStats: { collectionName: "support" },
  rankFusion: { collection: "support", embedding: [0.1], start },
  rawVectorSearch: { query: [0.1], pointIds: [1], vectors: [[0.2]], metric: "cosine" },
  recallCheck: { collection: "support", embedding: [0.1] },
  recommend: { collection: "support", positivePointIds: [1] },
  reconcilePoints: { collectionId, idempotencyKey },
  refreshOnboarding: {},
  registerFilterColumn: { collectionId, key: "tenant", column: "tenant_id", idempotencyKey },
  registerJsonbPath: { collectionId, key: "topic", column: "metadata", path: ["topic"], idempotencyKey },
  registerModelVersion: {
    collectionName: "support",
    modelName: "embed",
    modelVersion: "1",
    dimensions: 2,
    metric: "cosine",
  },
  registerVector: { collectionId, columnName: "embedding_v2", dimensions: 2, idempotencyKey },
  reindexCollection: { collectionId, idempotencyKey },
  retryOperation: { operationId, idempotencyKey },
  scroll: { collectionId, limit: 25, cursor: "points-cursor" },
  scrollPoints: { collectionId, limit: 25, cursor: "points-cursor" },
  search: { collection: "support", embedding: [0.1] },
  setDefaultCollection: { collectionId, idempotencyKey },
  setPayload: { collection: "support", sourceKeys: ["one"], payload: { title: "A" } },
  telemetry: { collectionName: "support" },
  textHybrid: { collection: "support", embedding: [0.1], query: "refund" },
  updateCollection: { collectionId, maxSearchLimit: 100, idempotencyKey },
  updateEmbeddingMigration: { collectionName: "support", migrationId: 1, processedPoints: 5, status: "running" },
  upsertPoints: { collectionId, sourceKeys: ["one"], idempotencyKey },
  vacuumAdvice: { collectionName: "support", indexName: "support_hnsw" },
  vectorFirst: { collection: "support", embedding: [0.1] },
  verifyCollection: { collectionId },
}

const invoke = (
  service: ContextService,
  binding: ContextOperationBinding,
  input: Readonly<Record<string, unknown>>,
) => {
  const member = service[binding.publicName as keyof ContextService] as unknown
  if (binding.pagination === "cursor") {
    return (member as { readonly page: (input: unknown) => Effect.Effect<unknown, unknown> }).page(input)
  }
  return (member as (input: unknown) => Effect.Effect<unknown, unknown>)(input)
}

test("all 83 network methods mechanically match ContextBindings", async () => {
  const requests: HttpTransport.Request[] = []
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      requests.push(request)
      return request.operation === "context.getCapabilities"
        ? Effect.succeed({ payload: availableCapabilities(), status: 200, headers: {} })
        : Effect.fail(transportError())
    },
  }
  const service = make(transport)
  await service.getCapabilities({}).pipe(Effect.runPromise)
  requests.length = 0
  const operations = contextBindings.filter(
    (binding): binding is ContextOperationBinding => binding.kind === "operation",
  )

  for (const binding of operations) {
    const input = inputs[binding.publicName]
    expect(input, binding.publicName).toBeDefined()
    await invoke(service, binding, input ?? {}).pipe(Effect.exit, Effect.runPromise)
  }

  expect(requests).toHaveLength(83)
  for (const [index, binding] of operations.entries()) {
    const request = requests[index]
    const input = inputs[binding.publicName] ?? {}
    expect(request?.method, binding.publicName).toBe(binding.method)
    expect(request?.path, binding.publicName).toBe(
      binding.path.replace(/^\/v1(?=\/)/, "").replace(/\{([a-z_]+)\}/g, (_, key: string) => {
        const camel = key.replace(/_([a-z])/g, (_match, character: string) => character.toUpperCase())
        return encodeURIComponent(String(input[camel]))
      }),
    )
    expect(request?.retry, binding.publicName).toBe(
      binding.retryPolicy === "never"
        ? "never"
        : binding.retryPolicy === "idempotentMutation"
          ? "idempotentMutation"
          : "readOnly",
    )
    expect(request?.body === undefined, binding.publicName).toBe(binding.requestBody === "none")
    expect(request?.headers?.["Idempotency-Key"], binding.publicName).toBe(
      binding.retryPolicy === "idempotentMutation" ? idempotencyKey : undefined,
    )
    expect(request?.expectedStatuses, binding.publicName).toEqual(
      Object.keys(manifestMethods.get(binding.publicName)?.operations[0]?.success_responses ?? {}).map(Number),
    )
  }

  expect(requests.find(({ operation }) => operation === "context.listCollections")?.query).toEqual({
    status: "ready",
    limit: 25,
    cursor: "collections-cursor",
  })
  expect(requests.find(({ operation }) => operation === "context.listOperations")?.query).toEqual({
    collection_id: collectionId,
    kind: "points_reconcile",
    status: "running",
    limit: 25,
    cursor: "operations-cursor",
  })
  expect(requests.find(({ operation }) => operation === "context.createCollection")?.body).toEqual({
    name: "support",
    source: {
      mode: "existing",
      schema_name: "public",
      table_name: "documents",
      source_key_column: "id",
      content_column: null,
      metadata_column: null,
    },
    vector: { name: null, column_name: "embedding", dimensions: 2, metric: "cosine" },
    text_column: null,
    result_columns: [],
    filter_columns: [],
    jsonb_filter_paths: [],
    index_kind: "hnsw",
    max_search_limit: 1_000,
  })
  expect(requests.find(({ operation }) => operation === "context.configureCollectionLimits")?.body).toEqual({
    strict_mode: true,
    max_dimensions: null,
    max_vectors: null,
    max_points: null,
    max_filter_nodes: null,
    max_search_limit: null,
    max_candidate_budget: null,
    query_timeout_ms: null,
    max_index_memory_bytes: null,
  })
  expect(requests.find(({ operation }) => operation === "context.rankFusion")?.body).toMatchObject({
    weights: { context: 0.7, graph: 0.3 },
  })
  expect(requests.find(({ operation }) => operation === "context.joint")?.body).toMatchObject({
    weights: { semantic: 0.7, lexical: 0, graph: 0.3 },
  })

  for (const [leftName, rightName] of [
    ["addVector", "registerVector"],
    ["deleteCollection", "dropCollection"],
    ["addFilterColumn", "registerFilterColumn"],
    ["addJsonbFilterPath", "registerJsonbPath"],
    ["facet", "facets"],
    ["query", "textHybrid"],
    ["scroll", "scrollPoints"],
  ]) {
    const left = requests.find(({ operation }) => operation === `context.${leftName}`)
    const right = requests.find(({ operation }) => operation === `context.${rightName}`)
    expect(left === undefined ? undefined : { ...left, operation: undefined }).toEqual(
      right === undefined ? undefined : { ...right, operation: undefined },
    )
  }
})

test("all aliases and 12 pure query builders are present and stable", () => {
  const service = make(capturingTransport([]))
  const publicNames = contextBindings.map(({ publicName }) => publicName).sort()
  expect(Object.keys(service).sort()).toEqual(publicNames)

  const nearest = service.queryNearest({ vector: [0.1], vectorName: "embedding" })
  const builders = [
    nearest,
    service.querySparseNearest({ vectorName: "sparse", vector: "refund" }),
    service.queryFullText({ textQuery: "refund", textColumn: "content" }),
    service.queryLateInteraction({ queryVectors: [[0.1]], candidatesPerQuery: 2 }),
    service.queryRecommend({ positivePointIds: [1], negativePointIds: [] }),
    service.queryDiscover({ contextPointIds: [1] }),
    service.queryLookup({ pointIds: [1] }),
    service.queryPrefetch({ branches: [nearest] }),
    service.queryWeight({ branch: nearest, weight: 0.5 }),
    service.queryScoreThreshold({ branch: nearest, minScore: 0.1 }),
    service.queryFormula({ branch: nearest, formula: "score" }),
    service.queryRerank({ branch: nearest, limit: 5 }),
  ]
  expect(builders.map(({ kind }) => kind)).toEqual([
    "nearest",
    "sparse_nearest",
    "full_text",
    "late_interaction",
    "recommend",
    "discover",
    "lookup",
    "prefetch",
    "weight",
    "score_threshold",
    "formula",
    "rerank",
  ])
  expect(Object.isFrozen(nearest)).toBe(true)
})

test("all capability-guarded methods preflight before their target request", async () => {
  const guarded = [
    "scroll",
    "scrollPoints",
    "count",
    "facet",
    "facets",
    "search",
    "groupedSearch",
    "recallCheck",
    "query",
    "textHybrid",
    "graphFirst",
    "vectorFirst",
    "rankFusion",
    "joint",
  ]
  for (const name of guarded) {
    const requests: HttpTransport.Request[] = []
    const transport: HttpTransport.Service = {
      request: () => Effect.die("unused"),
      requestWithMetadata: (request) => {
        requests.push(request)
        return request.operation === "context.getCapabilities"
          ? Effect.succeed({ payload: availableCapabilities(), status: 200, headers: {} })
          : Effect.fail(transportError())
      },
    }
    const binding = contextBindings.find(
      (candidate): candidate is ContextOperationBinding =>
        candidate.kind === "operation" && candidate.publicName === name,
    )
    expect(binding, name).toBeDefined()
    if (binding !== undefined)
      await invoke(make(transport), binding, inputs[name] ?? {}).pipe(Effect.exit, Effect.runPromise)
    expect(
      requests.map(({ operation }) => operation),
      name,
    ).toEqual(["context.getCapabilities", `context.${name}`])
  }
})

test("positive capabilities are cached while negative capabilities refresh", async () => {
  const requests: HttpTransport.Request[] = []
  let capabilityCalls = 0
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      requests.push(request)
      if (request.operation === "context.getCapabilities") {
        capabilityCalls++
        return Effect.succeed({
          payload: availableCapabilities(
            capabilityCalls === 1
              ? {
                  joint: false,
                  joint_blocker: "context_graph_not_ready",
                  joint_blocker_message: "Context Joint is unavailable for this project.",
                }
              : {},
          ),
          status: 200,
          headers: {},
        })
      }
      return Effect.fail(transportError())
    },
  }
  const service = make(transport)
  const unavailable = await service.joint(inputs.joint as never).pipe(Effect.flip, Effect.runPromise)
  expect(unavailable).toBeInstanceOf(PolygresError.InvalidInput)
  if (unavailable instanceof PolygresError.InvalidInput) {
    expect(unavailable.code).toBe("CONTEXT_CAPABILITY_UNAVAILABLE")
    expect(unavailable.message).toBe("Context Joint is unavailable for this project.")
    expect(unavailable.details).toEqual({ capability: "joint", blocker: "context_graph_not_ready" })
  }
  await service.joint(inputs.joint as never).pipe(Effect.exit, Effect.runPromise)
  await service.count(inputs.count as never).pipe(Effect.exit, Effect.runPromise)
  expect(capabilityCalls).toBe(2)
  expect(requests.map(({ operation }) => operation)).toEqual([
    "context.getCapabilities",
    "context.getCapabilities",
    "context.joint",
    "context.count",
  ])
})

test("capability limits fail locally in Python order while facets ignore project search limits", async () => {
  const requests: HttpTransport.Request[] = []
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      requests.push(request)
      return request.operation === "context.getCapabilities"
        ? Effect.succeed({
            payload: availableCapabilities({ max_search_limit: 5, max_dimensions: 1 }),
            status: 200,
            headers: {},
          })
        : Effect.fail(transportError())
    },
  }
  const service = make(transport)
  const error = await service
    .search({ collection: "support", embedding: [0.1, 0.2], limit: 6 })
    .pipe(Effect.flip, Effect.runPromise)
  expect(error).toBeInstanceOf(PolygresError.InvalidInput)
  if (error instanceof PolygresError.InvalidInput) {
    expect(error.code).toBe("CONTEXT_LIMIT_EXCEEDED")
    expect(error.details).toEqual({ field: "limit", limit: 5 })
  }
  await service.facets({ collection: "support", field: "tenant", limit: 10 }).pipe(Effect.exit, Effect.runPromise)
  expect(requests.map(({ operation }) => operation)).toEqual(["context.getCapabilities", "context.facets"])
})

test("every project-specific capability limit is enforced before dispatch", async () => {
  const cases: ReadonlyArray<{
    readonly name: keyof ContextService
    readonly input: Readonly<Record<string, unknown>>
    readonly capability: Readonly<Record<string, unknown>>
    readonly field: string
  }> = [
    {
      name: "search",
      input: { collection: "support", embedding: [0.1], limit: 2 },
      capability: { max_search_limit: 1 },
      field: "limit",
    },
    {
      name: "vectorFirst",
      input: { collection: "support", embedding: [0.1], contextLimit: 2 },
      capability: { max_context_limit: 1 },
      field: "context_limit",
    },
    {
      name: "graphFirst",
      input: { collection: "support", embedding: [0.1], start, graphLimit: 2 },
      capability: { max_graph_limit: 1 },
      field: "graph_limit",
    },
    {
      name: "joint",
      input: { collection: "support", embedding: [0.1], seedLimit: 2 },
      capability: { max_joint_seed_limit: 1 },
      field: "seed_limit",
    },
    {
      name: "joint",
      input: { collection: "support", embedding: [0.1], traversalLimit: 2 },
      capability: { max_joint_traversal_limit: 1 },
      field: "traversal_limit",
    },
    {
      name: "graphFirst",
      input: { collection: "support", embedding: [0.1], start, maxDepth: 2 },
      capability: { max_graph_depth: 1 },
      field: "max_depth",
    },
    {
      name: "search",
      input: { collection: "support", embedding: [0.1, 0.2] },
      capability: { max_dimensions: 1 },
      field: "embedding",
    },
    {
      name: "graphFirst",
      input: { collection: "support", embedding: [0.1], start, relationshipTypes: ["a", "b"] },
      capability: { max_relationship_types: 1 },
      field: "relationship_types",
    },
  ]
  for (const item of cases) {
    const requests: HttpTransport.Request[] = []
    const transport: HttpTransport.Service = {
      request: () => Effect.die("unused"),
      requestWithMetadata: (request) => {
        requests.push(request)
        return request.operation === "context.getCapabilities"
          ? Effect.succeed({ payload: availableCapabilities(item.capability), status: 200, headers: {} })
          : Effect.fail(transportError())
      },
    }
    const member = make(transport)[item.name] as unknown as (
      input: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<unknown, unknown>
    const error = await member(item.input).pipe(Effect.flip, Effect.runPromise)
    expect(error, item.field).toBeInstanceOf(PolygresError.InvalidInput)
    if (error instanceof PolygresError.InvalidInput) {
      expect(error.code, item.field).toBe("CONTEXT_LIMIT_EXCEEDED")
      expect(error.details?.field, item.field).toBe(item.field)
    }
    expect(
      requests.map(({ operation }) => operation),
      item.field,
    ).toEqual(["context.getCapabilities"])
  }
})

test("capability cache expires at the 60-second monotonic boundary", async () => {
  let capabilityCalls = 0
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      if (request.operation === "context.getCapabilities") {
        capabilityCalls++
        return Effect.succeed({ payload: availableCapabilities(), status: 200, headers: {} })
      }
      return Effect.fail(transportError())
    },
  }
  await Effect.gen(function* () {
    const service = make(transport)
    yield* service.search({ collection: "support", embedding: [0.1] }).pipe(Effect.exit)
    yield* TestClock.adjust("59 seconds")
    yield* service.count({ collection: "support" }).pipe(Effect.exit)
    expect(capabilityCalls).toBe(1)
    yield* TestClock.adjust("1 second")
    yield* service.count({ collection: "support" }).pipe(Effect.exit)
    expect(capabilityCalls).toBe(2)
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise)
})

test("capability metadata contains only additive envelope fields", async () => {
  const payload = availableCapabilities({ future_field: "kept" })
  Object.assign(payload.runtime, { future_runtime_field: "nested" })
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: () =>
      Effect.succeed({
        payload,
        status: 200,
        headers: {},
      }),
  }
  const capabilities = await make(transport).getCapabilities({}).pipe(Effect.runPromise)
  expect(capabilities.metadata).toEqual({ future_field: "kept" })
  expect((capabilities.runtime as unknown as Record<string, unknown>).future_runtime_field).toBe("nested")
})

const operationEnvelope = (
  id = operationId,
  status = "succeeded",
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  request_id: "req_operation",
  operation: {
    id,
    collection_id: collectionId,
    kind: "collection_reindex",
    status,
    stage: status === "succeeded" ? "ready" : "queued",
    processed_units: 1,
    total_units: 1,
    attempts: 1,
    retry_until: "2026-01-01T00:00:00Z",
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    finished_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  },
})

test("idempotency keys and encoded bodies are eager, protected, and stable across Effect.retry", async () => {
  const seen: HttpTransport.Request[] = []
  let attempts = 0
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      seen.push(request)
      attempts++
      return attempts === 1
        ? Effect.fail(transportError())
        : Effect.succeed({ payload: operationEnvelope(), status: 202, headers: {} })
    },
  }
  const effect = make(transport).reindexCollection({ collectionId })
  await effect.pipe(Effect.retry({ times: 1 }), Effect.runPromise)

  expect(seen).toHaveLength(2)
  expect(seen[0]?.headers?.["Idempotency-Key"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  expect(seen[1]?.headers).toEqual(seen[0]?.headers)
  expect(seen[1]?.body).toEqual(seen[0]?.body)
})

test("point mutations decode 200 and 202 as their declared union", async () => {
  const responses: HttpTransport.Response[] = [
    {
      status: 200,
      headers: {},
      payload: {
        request_id: "req_points",
        collection_id: collectionId,
        processed: 1,
        inserted: 1,
        reactivated: 0,
        already_active: 0,
        deleted: 0,
        already_absent: 0,
      },
    },
    {
      status: 202,
      headers: {},
      payload: operationEnvelope(operationId, "succeeded", { kind: "points_delete" }),
    },
  ]
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: () => Effect.succeed(responses.shift() as HttpTransport.Response),
  }
  const service = make(transport)
  const synchronous = await service.upsertPoints({ collectionId, sourceKeys: ["one"] }).pipe(Effect.runPromise)
  const durable = await service.deletePoints({ collectionId, sourceKeys: ["one"] }).pipe(Effect.runPromise)
  expect("processed" in synchronous && synchronous.processed).toBe(1)
  expect("status" in durable && durable.status).toBe("succeeded")
})

test("operation identity mismatch fails closed before returning a model", async () => {
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: () =>
      Effect.succeed({
        payload: operationEnvelope("00000000-0000-0000-0000-000000000003"),
        status: 200,
        headers: {},
      }),
  }
  const error = await make(transport).getOperation({ operationId }).pipe(Effect.flip, Effect.runPromise)
  expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
  expect(error.message).toContain("different Context operation")
})

test("mutation responses are bound to operation, collection, and kind", async () => {
  const otherId = "00000000-0000-0000-0000-000000000003"
  const otherCollectionId = "00000000-0000-0000-0000-000000000004"
  for (const method of ["cancelOperation", "retryOperation"] as const) {
    const transport: HttpTransport.Service = {
      request: () => Effect.die("unused"),
      requestWithMetadata: () => Effect.succeed({ payload: operationEnvelope(otherId), status: 200, headers: {} }),
    }
    const error = await make(transport)[method]({ operationId, idempotencyKey }).pipe(Effect.flip, Effect.runPromise)
    expect(error, method).toBeInstanceOf(PolygresError.InvalidResponse)
  }

  for (const overrides of [{ collection_id: otherCollectionId }, { kind: "collection_update" }]) {
    const transport: HttpTransport.Service = {
      request: () => Effect.die("unused"),
      requestWithMetadata: () =>
        Effect.succeed({ payload: operationEnvelope(operationId, "succeeded", overrides), status: 202, headers: {} }),
    }
    const error = await make(transport)
      .reindexCollection({ collectionId, idempotencyKey })
      .pipe(Effect.flip, Effect.runPromise)
    expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
  }

  const pointResponses: HttpTransport.Response[] = [
    {
      status: 200,
      headers: {},
      payload: {
        request_id: "req_points",
        collection_id: otherCollectionId,
        processed: 1,
        inserted: 1,
        reactivated: 0,
        already_active: 0,
        deleted: 0,
        already_absent: 0,
      },
    },
    { status: 202, headers: {}, payload: operationEnvelope() },
  ]
  const pointTransport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: () => Effect.succeed(pointResponses.shift() as HttpTransport.Response),
  }
  const pointService = make(pointTransport)
  const synchronous = await pointService
    .upsertPoints({ collectionId, sourceKeys: ["one"] })
    .pipe(Effect.flip, Effect.runPromise)
  const durable = await pointService
    .deletePoints({ collectionId, sourceKeys: ["one"] })
    .pipe(Effect.flip, Effect.runPromise)
  expect(synchronous).toBeInstanceOf(PolygresError.InvalidResponse)
  expect(durable).toBeInstanceOf(PolygresError.InvalidResponse)
})

test("wait uses the remaining request budget and terminal initial cancellation does not poll", async () => {
  const requests: HttpTransport.Request[] = []
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      requests.push(request)
      return Effect.succeed({ payload: operationEnvelope(), status: 200, headers: {}, retryAfterMillis: 0 })
    },
  }
  const service = make(transport)
  const completed = await service.waitForOperation({ operationId, timeout: "1 second" }).pipe(Effect.runPromise)
  expect(completed.status).toBe("succeeded")
  expect(Duration.toMillis(requests[0]?.timeout ?? Duration.zero)).toBeLessThanOrEqual(1_000)

  const cancelled: Operation.Value = { ...completed, status: "cancelled", stage: "cancelled" }
  const error = await service
    .waitForOperation({ operationId, initial: cancelled, timeout: "1 second" })
    .pipe(Effect.flip, Effect.runPromise)
  expect("code" in error && error.code).toBe("CONTEXT_OPERATION_CANCELLED")
  expect(requests).toHaveLength(1)

  const mismatch = await service
    .waitForOperation({
      operationId,
      initial: { ...completed, id: "00000000-0000-0000-0000-000000000003" },
    })
    .pipe(Effect.flip, Effect.runPromise)
  expect(mismatch).toBeInstanceOf(PolygresError.InvalidInput)
  expect(requests).toHaveLength(1)
})

test("invalid paths, queries, bodies, and protected-header attempts fail before transport", async () => {
  const requests: HttpTransport.Request[] = []
  const service = make(capturingTransport(requests))
  const effects = [
    service.getCollection({ collectionId: "support" as never }),
    service.listCollections.page({ limit: 101 as never }),
    service.search({ collection: "support", embedding: [] }),
    service.reindexCollection({ collectionId, idempotencyKey: "" }),
    (service.reindexCollection as (input: unknown) => Effect.Effect<unknown, unknown>)({
      collectionId,
      headers: { "Idempotency-Key": "attacker" },
    }),
  ]
  for (const effect of effects) {
    const error = await effect.pipe(Effect.flip, Effect.runPromise)
    expect(error).toBeInstanceOf(PolygresError.InvalidInput)
  }
  expect(requests).toEqual([])
})

test("request IDs and operation metadata are sanitized and private result payloads are dropped", async () => {
  const secret = "poly_live_0123456789abcdef0123456789abcdef"
  const payload = operationEnvelope()
  payload.request_id = `request-${secret}`
  Object.assign(payload.operation, { future_note: `unsafe-${secret}`, result_payload: { private: secret } })
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: () => Effect.succeed({ payload, status: 200, headers: {} }),
  }
  const operation = await make(transport).getOperation({ operationId }).pipe(Effect.runPromise)
  expect(Option.getOrUndefined(operation.requestId)).toBe("request-[REDACTED]")
  expect(operation.metadata).toEqual({ future_note: "unsafe-[REDACTED]" })
  expect(JSON.stringify(operation)).not.toContain(secret)
  expect("resultPayload" in operation.metadata).toBe(false)
})

test("cursor operations expose cold page and stream APIs", async () => {
  const requests: HttpTransport.Request[] = []
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: (request) => {
      requests.push(request)
      return Effect.succeed(
        request.operation === "context.getCapabilities"
          ? {
              status: 200,
              headers: {},
              payload: availableCapabilities(),
            }
          : {
              status: 200,
              headers: {},
              payload: {
                request_id: "req_page",
                collection_id: collectionId,
                points: [{ point_id: 1, source_key: "one" }],
                next_cursor: null,
                has_more: false,
              },
            },
      )
    },
  }
  const service = make(transport)
  await service.getCapabilities({}).pipe(Effect.runPromise)
  requests.length = 0
  const scroll = service.scroll
  const stream = scroll.stream({ collectionId })
  expect(requests).toEqual([])
  const items = await stream.pipe(Stream.runCollect, Effect.runPromise)
  expect(Array.from(items, ({ sourceKey }) => sourceKey)).toEqual(["one"])
  expect(requests[0]?.query).toEqual({ limit: 50 })
})

test("operation pages attach sanitized envelope IDs and per-item metadata", async () => {
  const secret = "poly_live_0123456789abcdef0123456789abcdef"
  const item = operationEnvelope().operation
  Object.assign(item, { future_note: secret })
  const transport: HttpTransport.Service = {
    request: () => Effect.die("unused"),
    requestWithMetadata: () =>
      Effect.succeed({
        status: 200,
        headers: {},
        payload: {
          request_id: `list-${secret}`,
          operations: [item],
          next_cursor: null,
          has_more: false,
        },
      }),
  }
  const page = await make(transport).listOperations.page({}).pipe(Effect.runPromise)
  expect(Option.getOrUndefined(page.items[0]?.requestId ?? Option.none())).toBe("list-[REDACTED]")
  expect(page.items[0]?.metadata).toEqual({ future_note: "[REDACTED]" })
})
