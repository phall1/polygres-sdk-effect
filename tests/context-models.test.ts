import { expect, test } from "bun:test"
import { DateTime, Option, Schema } from "effect"

import * as Context from "../src/Context.js"
import { decodeResponse, encodeRequest, normalizeResponse } from "../src/internal/ContextWire.js"

const collectionId = "00000000-0000-0000-0000-000000000001"
const operationId = "00000000-0000-0000-0000-000000000002"

test("operation responses normalize snake casing, Python numerics, dates, and nullable state", () => {
  const response = decodeResponse(Context.OperationEnvelope, {
    request_id: "req_operation",
    future_envelope_field: true,
    operation: {
      id: operationId,
      collection_id: null,
      kind: "collection_create",
      status: "running",
      stage: "building_index",
      processed_units: "1_024",
      total_units: null,
      attempts: "2",
      retry_until: "2026-07-29T00:00:00Z",
      error: null,
      created_at: "2026-07-29T00:00:00Z",
      started_at: null,
      finished_at: null,
      updated_at: "2026-07-29T00:01:00Z",
      result_payload: { private: true },
    },
  })

  expect(response.requestId).toBe("req_operation")
  expect(response.operation.processedUnits).toBe(1_024)
  expect(response.operation.attempts).toBe(2)
  expect(Option.isNone(response.operation.collectionId)).toBe(true)
  expect(Option.isNone(response.operation.totalUnits)).toBe(true)
  expect(Option.isNone(response.operation.error)).toBe(true)
  expect(DateTime.isDateTime(response.operation.updatedAt)).toBe(true)
  expect((response as unknown as Record<string, unknown>).future_envelope_field).toBe(true)
  expect("resultPayload" in response.operation).toBe(false)
})

test("joint responses retain typed provenance and convert every nullable lane to Option", () => {
  const response = decodeResponse(Context.ContextJointResponse, {
    request_id: "req_joint",
    collection: { id: collectionId, name: "support_docs" },
    mode: "joint",
    results: [
      {
        point_id: "2",
        source: { schema: "public", table: "documents", id: "doc-2" },
        rank: "1",
        score: "0.016",
        score_kind: "joint_weighted_rrf",
        metric: null,
        properties: { title: "Graph result" },
        group_value: null,
        group_rank: null,
        introduced_by_graph: true,
        baseline_rank: null,
        rank_lift: null,
        context: { rank: 1, score: "0.99", metric: "cosine" },
        lexical: null,
        graph: { rank: 1, depth: "1", relationships: [] },
        score_breakdown: { semantic: "0.0096", lexical: 0, graph: "0.0064", total: "0.016" },
        additive_result_field: "ignored",
      },
    ],
    fusion: {
      method: "joint_weighted_rrf",
      k: "60",
      weights: { semantic: "0.6", lexical: "0", graph: "0.4" },
    },
    trace: {
      semantic_candidates: "1",
      lexical_candidates: 0,
      explicit_seeds: 0,
      retrieval_seeds: 1,
      retained_seeds: 1,
      graph_candidates: 1,
      combined_candidates: 2,
      rescored_candidates: 2,
    },
    warnings: [],
  })

  const result = response.results[0]
  expect(result?.pointId).toBe(2)
  expect(result?.source.schema).toBe("public")
  expect(Option.isNone(result?.baselineRank ?? Option.some(1))).toBe(true)
  expect(Option.isNone(result?.lexical ?? Option.some({ rank: 1, score: 1 }))).toBe(true)
  expect(Option.isSome(result?.graph ?? Option.none())).toBe(true)
  expect(Option.getOrThrow(result?.graph ?? Option.none()).depth).toBe(1)
  expect(response.fusion.weights.graph).toBe(0.4)
  expect(response.trace.combinedCandidates).toBe(2)
  expect((result as unknown as Record<string, unknown>).additive_result_field).toBe("ignored")
})

test("request encoding validates camelCase models, emits wire casing, and applies Python deduplication", () => {
  const payload = encodeRequest(Context.CollectionCreateRequest, {
    name: "support_docs",
    source: {
      mode: "existing",
      schemaName: "public",
      tableName: "documents",
      sourceKeyColumn: "id",
    },
    vector: { columnName: "embedding", dimensions: 2, metric: "cosine" },
    textColumn: "content",
    filterColumns: ["tenant_id"],
    jsonbFilterPaths: [{ key: "topic", column: "metadata", path: ["topic"] }],
    maxSearchLimit: 500,
  })

  expect(payload).toEqual({
    name: "support_docs",
    source: {
      content_column: null,
      metadata_column: null,
      mode: "existing",
      schema_name: "public",
      table_name: "documents",
      source_key_column: "id",
    },
    vector: { name: null, column_name: "embedding", dimensions: 2, metric: "cosine" },
    text_column: "content",
    result_columns: [],
    filter_columns: ["tenant_id"],
    jsonb_filter_paths: [{ key: "topic", column: "metadata", path: ["topic"] }],
    index_kind: "hnsw",
    max_search_limit: 500,
  })

  expect(encodeRequest(Context.PointKeysRequest, { sourceKeys: ["doc-1", "doc-1", "doc-2"] })).toEqual({
    source_keys: ["doc-1", "doc-2"],
  })
})

test("public primitive and request schemas enforce Python UUID, identifier, idempotency, and range rules", () => {
  const accepts = <A>(schema: Schema.Schema<A>, value: unknown) => Schema.is(schema)(value)

  expect(accepts(Context.Uuid, collectionId)).toBe(true)
  expect(accepts(Context.Uuid, "support_docs")).toBe(false)
  expect(accepts(Context.CollectionRef, "support_docs")).toBe(true)
  expect(accepts(Context.CollectionRef, "not-a-name")).toBe(false)
  expect(accepts(Context.Identifier, "a".repeat(63))).toBe(true)
  expect(accepts(Context.Identifier, "a".repeat(64))).toBe(false)
  expect(accepts(Context.IdempotencyKey, "sdk-context-idempotency")).toBe(true)
  expect(accepts(Context.IdempotencyKey, "line\nbreak")).toBe(false)
  expect(accepts(Context.IdempotencyKey, "x".repeat(129))).toBe(false)
  expect(accepts(Context.AdminPageLimit, 100)).toBe(true)
  expect(accepts(Context.AdminPageLimit, 101)).toBe(false)
  expect(
    accepts(Context.RecallCheckRequest, { collection: "support_docs", embedding: [0.1], minimumRecall: 1.01 }),
  ).toBe(false)
  expect(accepts(Context.VectorCreateRequest, { dimensions: 16_001 })).toBe(false)
  expect(accepts(Context.CollectionUpdateRequest, {})).toBe(false)
  expect(accepts(Context.CollectionUpdateRequest, { resultColumns: ["__polygres_source_id"] })).toBe(true)
  expect(accepts(Context.SetPayloadRequest, { sourceKeys: ["doc-1"], collection: "support_docs", payload: {} })).toBe(
    false,
  )
  expect(accepts(Context.DiscoveryRequest, { schemaNames: null })).toBe(true)
  expect(accepts(Context.DiscoveryRequest, { schemaNames: [] })).toBe(false)
  expect(
    accepts(Context.RegisterModelVersionRequest, {
      collection: "support_docs",
      modelName: "😀".repeat(128),
      modelVersion: "v1",
      dimensions: 1,
      metric: "cosine",
    }),
  ).toBe(true)
  expect(
    accepts(Context.RegisterModelVersionRequest, {
      collection: "support_docs",
      modelName: "😀".repeat(129),
      modelVersion: "v1",
      dimensions: 1,
      metric: "cosine",
    }),
  ).toBe(false)
})

test("wire normalization is non-mutating and preserves opaque JSON values", () => {
  const input = {
    request_id: "req",
    normalized_request: { schema_name: "public", values: [1, "2"] },
    future_additive: { point_id: "9007199254740993", result_payload: { private: true } },
  }
  const normalized = normalizeResponse(input)

  expect(normalized).toEqual({
    requestId: "req",
    normalizedRequest: { schema_name: "public", values: [1, "2"] },
    future_additive: { point_id: "9007199254740993" },
  })
  expect(input.future_additive.result_payload).toEqual({ private: true })
  expect(
    encodeRequest(Context.SetPayloadRequest, {
      collection: "support_docs",
      sourceKeys: ["doc-1"],
      payload: { user_defined_key: { remains_snake_case: true } },
    }),
  ).toEqual({
    collection: "support_docs",
    source_keys: ["doc-1"],
    payload: { user_defined_key: { remains_snake_case: true } },
  })
})

test("response defaults match the pinned extra-allowing models", () => {
  const runtime = decodeResponse(Context.RuntimeCapabilities, {
    postgres_major: "17",
    pgcontext_version: null,
    pgcontext_source_commit: null,
    pgvector_installed: "yes",
    pgcontext_installed: 1,
  })
  expect(runtime.sameColumnBridge).toBe(false)
  expect(runtime.pgvectorInstalled).toBe(true)
  expect(runtime.pgcontextInstalled).toBe(true)

  const candidate = decodeResponse(Context.DiscoveryCandidate, {
    classification: "ready_to_configure",
    source: { schema_name: "public", table_name: "documents", source_key_column: "id", source_key_type: "text" },
    vectors: [],
    reasons: [],
  })
  expect(candidate.columns).toEqual([])

  const vector = decodeResponse(Context.CollectionVector, {
    id: collectionId,
    name: "default",
    column_name: "embedding",
    is_default: true,
    owns_vector_column: false,
    dimensions: 2,
    metric: "cosine",
    index_kind: "hnsw",
    index_name: null,
    owns_index: false,
    index_status: "ready",
    last_error_code: null,
    last_error_stage: null,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
  })
  expect(vector.vectorTypeOwner).toBe("pgcontext")
})

test("collection response JSONB paths remain opaque and private result payloads are removed recursively", () => {
  const collection = decodeResponse(Context.Collection, {
    id: collectionId,
    project_id: "project",
    name: "support_docs",
    is_default: true,
    status: "ready",
    schema_name: "public",
    table_name: "documents",
    source_key_column: "id",
    source_key_type: "text",
    source_mode: "existing",
    owns_source_table: false,
    default_vector_name: "default",
    vectors: [],
    max_search_limit: 1000,
    text_column: null,
    result_columns: [],
    filter_columns: [],
    jsonb_filter_paths: [{ arbitrary_shape: { nested_key: true, result_payload: { private: true } } }],
    point_reconciliation_status: "current",
    mapped_point_count: null,
    last_reconciled_at: null,
    last_error_code: null,
    last_error_stage: null,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    future_field: { score: "not-a-number", result_payload: true },
  })

  expect(collection.jsonbFilterPaths).toEqual([{ arbitrary_shape: { nested_key: true } }])
  expect((collection as unknown as Record<string, unknown>).future_field).toEqual({ score: "not-a-number" })
})

test("typed wire coercion covers provenance and rejects unsafe integers", () => {
  const result = decodeResponse(Context.JointResult, {
    point_id: "2",
    source: { schema: "public", table: "documents", id: "doc-2" },
    rank: "1",
    score: "1000000000.5",
    score_kind: "joint_weighted_rrf",
    metric: null,
    properties: { point_id: "9007199254740993" },
    group_value: null,
    group_rank: null,
    introduced_by_graph: "false",
    baseline_rank: "2",
    rank_lift: "1",
    context: { rank: "1", score: "1", metric: "cosine" },
    lexical: null,
    graph: null,
    score_breakdown: { semantic: "1000000000", lexical: 0, graph: 0, total: "1000000000" },
  })

  expect(result.introducedByGraph).toBe(false)
  expect(Option.getOrThrow(result.baselineRank)).toBe(2)
  expect((result.properties as Record<string, unknown>).point_id).toBe("9007199254740993")
  expect(() => decodeResponse(Context.PointMapping, { point_id: "9007199254740992", source_key: "doc" })).toThrow()
})

test("joint trace maxima and Python math.isclose tolerances are exact", () => {
  const traceMax = {
    semanticCandidates: 1_000,
    lexicalCandidates: 1_000,
    explicitSeeds: 32,
    retrievalSeeds: 32,
    retainedSeeds: 32,
    graphCandidates: 1_000,
    combinedCandidates: 3_000,
    rescoredCandidates: 3_000,
  }
  expect(Schema.is(Context.JointTrace)(traceMax)).toBe(true)
  for (const key of Object.keys(traceMax) as Array<keyof typeof traceMax>) {
    expect(Schema.is(Context.JointTrace)({ ...traceMax, [key]: traceMax[key] + 1 })).toBe(false)
  }

  expect(Schema.is(Context.JointScoreBreakdown)({ semantic: 1e9, lexical: 0, graph: 0, total: 1e9 + 0.5 })).toBe(true)
  expect(Schema.is(Context.JointScoreBreakdown)({ semantic: 0, lexical: 0, graph: 0, total: 2e-12 })).toBe(false)
  expect(Schema.is(Context.JointFusionWeights)({ semantic: 0.7, lexical: 0, graph: 0.3000000009 })).toBe(true)
  expect(Schema.is(Context.JointFusionWeights)({ semantic: 0.7, lexical: 0, graph: 0.3000000011 })).toBe(false)
})

test("request decoding materializes pinned defaults and trims joint queries", () => {
  expect(encodeRequest(Context.DiscoveryRequest, {})).toEqual({ schema_names: null })
  expect(encodeRequest(Context.VectorCreateRequest, { dimensions: 2 })).toEqual({
    name: null,
    column_name: "embedding",
    dimensions: 2,
    metric: "cosine",
    mode: "existing",
    index_kind: "hnsw",
    set_default: false,
  })

  expect(
    encodeRequest(Context.JointSearchRequest, {
      collection: "support_docs",
      embedding: [0.1],
      query: "  refund  ",
    }),
  ).toEqual({
    collection: "support_docs",
    vector_name: null,
    embedding: [0.1],
    filter: null,
    limit: 10,
    max_depth: 2,
    graph_limit: 200,
    relationship_types: [],
    direction: "any",
    query: "refund",
    starts: [],
    context_limit: 50,
    seed_limit: 8,
    traversal_limit: 500,
    weights: { semantic: 0.7, lexical: 0, graph: 0.3 },
  })
})
