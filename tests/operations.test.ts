import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { Polygres } from "../src/index.js"

const key = "poly_live_0123456789abcdef0123456789abcdef"
const runtimeUrl = "https://p0123456789abcdef0123456.api.db.polygres.com/v1"

test("all retrieval operations serialize their reviewed wire contracts", async () => {
  const requests: Array<{ readonly path: string; readonly body: unknown }> = []
  const http = HttpClient.make((request) => {
    const path = new URL(request.url).pathname
    const body =
      request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined
    requests.push({ path, body })
    const response = path.endsWith("/graph/path")
      ? { paths: [] }
      : path.endsWith("/graph/connection")
        ? { connections: [] }
        : { results: [], next_cursor: null, has_more: false }
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(response)))
  })

  await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    const start = { schema: "public", table: "entities", id: "a" } as const
    const target = { schema: "public", table: "entities", id: "b" } as const
    const embedding = [0.1] as const

    yield* client.graph.expand.page({ start })
    yield* client.graph.neighborhood.page({ start })
    yield* client.graph.related.page({ start })
    yield* client.graph.path({ source: start, target })
    yield* client.graph.connection({ entities: [start, target] })
    yield* client.vector.search.page({ embedding })
    yield* client.vector.similarTo.page({ rowId: "row-1" })
    yield* client.text.tsvector.page({ query: "campaign", config: "documents" })
    yield* client.text.fuzzy.page({ query: "campain", config: "documents" })
    yield* client.hybrid.graphFirst.page({ start, embedding })
    yield* client.hybrid.vectorFirst.page({ embedding })
    yield* client.hybrid.joint.page({ start, embedding })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(requests).toEqual([
    {
      path: "/v1/graph/expand",
      body: {
        start: { schema: "public", table: "entities", id: "a" },
        max_depth: 5,
        direction: "out",
        filters: {},
        limit: 50,
      },
    },
    {
      path: "/v1/graph/neighborhood",
      body: {
        start: { schema: "public", table: "entities", id: "a" },
        max_depth: 2,
        direction: "any",
        filters: {},
        limit: 100,
      },
    },
    {
      path: "/v1/graph/related",
      body: {
        start: { schema: "public", table: "entities", id: "a" },
        max_depth: 1,
        direction: "any",
        filters: {},
        limit: 20,
      },
    },
    {
      path: "/v1/graph/path",
      body: {
        source: { schema: "public", table: "entities", id: "a" },
        target: { schema: "public", table: "entities", id: "b" },
        max_depth: 5,
        direction: "any",
      },
    },
    {
      path: "/v1/graph/connection",
      body: {
        entities: [
          { schema: "public", table: "entities", id: "a" },
          { schema: "public", table: "entities", id: "b" },
        ],
        max_depth: 5,
        direction: "any",
      },
    },
    {
      path: "/v1/vector/search",
      body: { embedding: [0.1], filters: {}, include_values: false },
    },
    {
      path: "/v1/vector/similar-to",
      body: { row_id: "row-1", filters: {}, include_values: false },
    },
    {
      path: "/v1/text/tsvector",
      body: { query: "campaign", config: "documents", limit: 10, filters: {} },
    },
    {
      path: "/v1/text/fuzzy",
      body: { query: "campain", config: "documents", limit: 10, filters: {} },
    },
    {
      path: "/v1/hybrid/graph-first",
      body: {
        embedding: [0.1],
        start: { schema: "public", table: "entities", id: "a" },
        max_depth: 2,
        direction: "any",
        filters: {},
        weights: { vector: 0.7, graph: 0.3 },
        limit: 10,
      },
    },
    {
      path: "/v1/hybrid/vector-first",
      body: {
        embedding: [0.1],
        max_depth: 1,
        direction: "any",
        filters: {},
        weights: { vector: 0.7, graph: 0.3 },
        vector_limit: 20,
        limit: 10,
      },
    },
    {
      path: "/v1/hybrid/joint",
      body: {
        embedding: [0.1],
        start: { schema: "public", table: "entities", id: "a" },
        max_depth: 2,
        direction: "any",
        filters: {},
        weights: { vector: 0.7, graph: 0.3 },
        vector_limit: 20,
        limit: 10,
      },
    },
  ])
})
