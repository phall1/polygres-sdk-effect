import { expect, test } from "bun:test"
import { Schema } from "effect"
import * as Context from "../src/Context.js"
import * as Query from "../src/ContextQuery.js"
import { encodeRequest } from "../src/internal/ContextWire.js"

test("query builders compose the official dense and lexical rerank plan immutably", () => {
  const filter: Query.Filter = { must: [{ key: "tenant_id", match: "acme" }] }
  const dense = Query.queryNearest([0.1, 0.2], 20, { vectorName: "embedding_v2", filter })
  const lexical = Query.queryFullText("refund", "content", 20)
  const prefetched = Query.queryPrefetch([Query.queryWeight(dense, 0.7), Query.queryWeight(lexical, 0.3)])
  const plan = Query.queryRerank(prefetched, 10)

  expect(plan).toEqual({
    kind: "rerank",
    branch: {
      kind: "prefetch",
      branches: [
        {
          kind: "weight",
          branch: {
            kind: "nearest",
            vector: [0.1, 0.2],
            vectorName: "embedding_v2",
            filter: { must: [{ key: "tenant_id", match: "acme" }] },
            limit: 20,
          },
          weight: 0.7,
        },
        {
          kind: "weight",
          branch: { kind: "full_text", textQuery: "refund", textColumn: "content", limit: 20 },
          weight: 0.3,
        },
      ],
    },
    limit: 10,
  })
  expect(Object.isFrozen(plan)).toBe(true)
  expect(Object.isFrozen(plan.branch)).toBe(true)
  if (plan.branch.kind !== "prefetch") throw new Error("expected prefetch branch")
  expect(Object.isFrozen(plan.branch.branches)).toBe(true)

  expect(encodeRequest(Context.QueryExecuteRequest, { collection: "support_docs", plan })).toEqual({
    collection: "support_docs",
    plan: {
      kind: "rerank",
      branch: {
        kind: "prefetch",
        branches: [
          {
            kind: "weight",
            branch: {
              kind: "nearest",
              vector: [0.1, 0.2],
              vector_name: "embedding_v2",
              filter: { must: [{ key: "tenant_id", match: "acme" }] },
              limit: 20,
            },
            weight: 0.7,
          },
          {
            kind: "weight",
            branch: { kind: "full_text", text_query: "refund", text_column: "content", limit: 20 },
            weight: 0.3,
          },
        ],
      },
      limit: 10,
    },
  })
})

test("all query plan branches have precise builder output", () => {
  const nearest = Query.queryNearest([1])
  const branches: ReadonlyArray<Query.QueryPlan> = [
    nearest,
    Query.querySparseNearest("sparse", "{1:0.5}", 5),
    Query.queryFullText("refund", "content"),
    Query.queryLateInteraction(
      [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      20,
    ),
    Query.queryRecommend([1], [2]),
    Query.queryDiscover([1]),
    Query.queryLookup([1, 2]),
    Query.queryPrefetch([nearest]),
    Query.queryWeight(nearest, 0),
    Query.queryScoreThreshold(nearest, 0.2, 0.8),
    Query.queryFormula(nearest, "score * 2"),
    Query.queryRerank(nearest, 5),
  ]

  expect(branches.map((branch) => branch.kind)).toEqual([
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
  expect(branches.every(Object.isFrozen)).toBe(true)
})

test("query builders reject invalid shapes before HTTP integration", () => {
  const nearest = Query.queryNearest([0.1])
  const invalid = [
    () => Query.queryNearest([], 10),
    () => Query.queryNearest([Number.NaN], 10),
    () => Query.querySparseNearest("not a name", "{1:1}"),
    () => Query.querySparseNearest("sparse", "   "),
    () => Query.queryFullText("   ", "content"),
    () => Query.queryLateInteraction([[0.1], [0.2, 0.3]], 10),
    () => Query.queryRecommend([], [], 10),
    () => Query.queryDiscover([]),
    () => Query.queryLookup([]),
    () => Query.queryPrefetch([]),
    () => Query.queryWeight(nearest, -0.1),
    () => Query.queryScoreThreshold(nearest, 0.8, 0.2),
    () => Query.queryFormula(nearest, "   "),
    () => Query.queryRerank(nearest, 0),
  ]

  for (const build of invalid) expect(build).toThrow()
})

test("validated request filters enforce reserved keys and aggregate Python budgets", () => {
  const accepts = Schema.is(Query.Filter)
  const condition = { key: "tenant_id", match: "acme" } as const

  for (const filter of [
    { must: [{ key: "__polygres_source_id", match: "x" }] },
    { should: [{ key: "__polygres_source_id", isNull: true }] },
    { mustNot: [{ key: "__polygres_source_id", range: { gt: 1 } }] },
  ]) {
    expect(accepts(filter)).toBe(false)
  }

  expect(accepts({ must: Array.from({ length: 256 }, () => condition) })).toBe(true)
  expect(accepts({ must: Array.from({ length: 257 }, () => condition) })).toBe(false)
  expect(
    accepts({
      must: [
        { key: "a", match: { any: Array.from({ length: 1_000 }, (_, index) => index) } },
        { key: "b", match: { except: Array.from({ length: 1_000 }, (_, index) => index) } },
      ],
    }),
  ).toBe(true)
  expect(
    accepts({
      must: [
        { key: "a", match: { any: Array.from({ length: 1_000 }, (_, index) => index) } },
        { key: "b", match: { except: Array.from({ length: 1_000 }, (_, index) => index) } },
        { key: "c", match: "overflow" },
      ],
    }),
  ).toBe(false)

  const emptyFilterBytes = new TextEncoder().encode(JSON.stringify({ must: [{ key: "k", match: "" }] })).length
  const exactBytes = "x".repeat(65_536 - emptyFilterBytes)
  expect(accepts({ must: [{ key: "k", match: exactBytes }] })).toBe(true)
  expect(accepts({ must: [{ key: "k", match: `${exactBytes}x` }] })).toBe(false)
})

test("query-plan filters are opaque nullable dictionaries and plan limits are unbounded above", () => {
  const arbitraryFilter = {
    must_not: [{ key: "__polygres_source_id", custom_operator: { user_key: true } }],
  }
  const plan = Query.queryNearest([1], 100_000, { filter: arbitraryFilter })
  expect(plan).toEqual({ kind: "nearest", vector: [1], limit: 100_000, filter: arbitraryFilter })
  expect(encodeRequest(Context.QueryExecuteRequest, { collection: "support_docs", plan })).toEqual({
    collection: "support_docs",
    plan: { kind: "nearest", vector: [1], limit: 100_000, filter: arbitraryFilter },
  })

  expect(Query.queryNearest([1], 1, { filter: null })).toEqual({ kind: "nearest", vector: [1], limit: 1, filter: null })
  expect(() => Query.queryNearest([1], 10, { unexpectedField: true } as never)).toThrow()
})
