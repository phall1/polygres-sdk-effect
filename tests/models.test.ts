import { expect, test } from "bun:test"
import { Effect, Fiber, Latch, Option, Random } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { Polygres, PolygresError } from "../src/index.js"

const key = "poly_live_0123456789abcdef0123456789abcdef"
const runtimeUrl = "https://p0123456789abcdef0123456.api.db.polygres.com/v1"

test("graph results hydrate node properties and normalize nullable fields", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          results: [
            {
              node: { schema: "public", table: "entities", id: 42 },
              properties: { name: "Example" },
              depth: " +2 ",
              graph_score: "0.5",
              relationships: [],
            },
          ],
          next_cursor: null,
          has_more: false,
          groups: [{ depth: 2 }],
        }),
      ),
    ),
  )
  const page = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.graph.expand.page({ start: { schema: "public", table: "entities", id: "42" } })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(page.items[0]?.node).toEqual({
    schema: "public",
    table: "entities",
    id: "42",
    properties: { name: "Example" },
  })
  expect(Option.getOrUndefined(page.items[0]?.graphScore ?? Option.none())).toBe(0.5)
  expect(page.items[0]?.depth).toBe(2)
  expect(Option.isNone(page.items[0]?.rank ?? Option.some(0))).toBe(true)
  expect(page.metadata).toEqual({ groups: [{ depth: 2 }] })
})

test("page envelopes preserve cursor state and nested metadata independently", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          results: [],
          next_cursor: "kept-for-inspection",
          has_more: false,
          metadata: { trace: "nested" },
        }),
      ),
    ),
  )
  const page = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.vector.search.page({ embedding: [0.1] })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(Option.getOrUndefined(page.nextCursor)).toBe("kept-for-inspection")
  expect(page.hasMore).toBe(false)
  expect(page.metadata).toEqual({ metadata: { trace: "nested" } })
})

test("page envelopes default absent pagination fields", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ results: [] }))),
  )
  const page = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.vector.search.page({ embedding: [0.1] })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(Option.isNone(page.nextCursor)).toBe(true)
  expect(page.hasMore).toBe(false)
})

test("domain schemas reject invalid values tolerated by the wire adapter", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          results: [{ node: { schema: "", table: "entities", id: "entity-1" }, properties: {} }],
        }),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(
      client.graph.expand.page({ start: { schema: "public", table: "entities", id: "entity-1" } }),
    )
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
  if (error instanceof PolygresError.InvalidResponse) {
    expect(error.issues?.some((issue) => issue.path.includes("schema"))).toBe(true)
  }
})

test("text and path responses normalize casing while preserving opaque metadata", async () => {
  const http = HttpClient.make((request) => {
    const response = request.url.endsWith("/graph/path")
      ? { paths: [], request_id: "req_path", execution_ms: 3 }
      : {
          results: [
            {
              schema: "public",
              table: "documents",
              id: "doc-1",
              properties: {},
              score: "0.8",
              similarity: null,
            },
          ],
          next_cursor: null,
          has_more: false,
        }
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(response)))
  })
  const result = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    const text = yield* client.text.tsvector.page({ query: "campaign", config: "documents" })
    const path = yield* client.graph.path({
      source: { schema: "public", table: "entities", id: "a" },
      target: { schema: "public", table: "entities", id: "b" },
    })
    return { text, path }
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(result.text.items[0]?.score).toBe(0.8)
  expect(Option.isNone(result.text.items[0]?.similarity ?? Option.some(0))).toBe(true)
  expect(Option.getOrUndefined(result.path.requestId)).toBe("req_path")
  expect(result.path.metadata).toEqual({ execution_ms: 3 })
  expect("request_id" in result.path).toBe(false)
})

test("connection info uses nested camelCase endpoints", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          project_id: "p0123456789abcdef0123456",
          project_mode: "standard",
          database: "postgres",
          username: "user",
          port: " 5_432 ",
          direct: { host: "direct", connection_string_without_password: "postgres://direct" },
          pooled: { host: "pooled", connection_string_without_password: "postgres://pooled" },
        }),
      ),
    ),
  )
  const value = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.connectionInfo()
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(value.projectId).toBe("p0123456789abcdef0123456")
  expect(Option.getOrUndefined(value.projectMode)).toBe("standard")
  expect(value.port).toBe(5432)
  expect(value.direct.urlWithoutPassword).toBe("postgres://direct")
})

test("rate limits expose parsed Retry-After without trusting response text", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          { error: { code: "RATE_LIMITED", message: "untrusted" } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.RateLimited)
  if (error instanceof PolygresError.RateLimited) {
    expect(error.retryAfterMillis).toBe(2_000)
    expect(error.message).toBe("Too many requests. Try again later.")
  }
})

test("HTTP-date Retry-After values use Effect Clock time", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({}, { status: 429, headers: { "retry-after": "Thu, 01 Jan 1970 00:00:02 GMT" } }),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.provide(TestClock.layer()), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.RateLimited)
  if (error instanceof PolygresError.RateLimited) expect(error.retryAfterMillis).toBe(2_000)
})

test("negative Retry-After uses the official 25-30ms fallback backoff", async () => {
  let calls = 0
  const result = await Effect.gen(function* () {
    const firstReturned = yield* Latch.make()
    const http = HttpClient.make((request) => {
      calls++
      const response = HttpClientResponse.fromWeb(
        request,
        calls === 1
          ? Response.json({}, { status: 503, headers: { "retry-after": "-1" } })
          : Response.json({
              project_id: "p0123456789abcdef0123456",
              graph: { ready: true },
              vector: { ready: true },
              hybrid: { ready: true },
            }),
      )
      return calls === 1 ? firstReturned.open.pipe(Effect.as(response)) : Effect.succeed(response)
    })
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 1 }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    )
    const fiber = yield* client.readiness().pipe(Effect.forkChild)
    yield* firstReturned.await
    yield* Effect.yieldNow
    yield* TestClock.adjust("24 millis")
    expect(calls).toBe(1)
    yield* TestClock.adjust("6 millis")
    return yield* Fiber.join(fiber)
  }).pipe(Random.withSeed("polygres-backoff"), Effect.provide(TestClock.layer()), Effect.runPromise)

  expect(calls).toBe(2)
  expect(result.graph.ready).toBe(true)
})

test("an operation deadline interrupts Retry-After backoff", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({}, { status: 503, headers: { "retry-after": "10" } })),
    )
  })
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 2, deadline: "1 millis" })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.RequestTimeout)
  if (error instanceof PolygresError.RequestTimeout) expect(error.kind).toBe("deadline")
  expect(calls).toBe(1)
})

test("schema constraints reject malformed calls without transport", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({})))
  })
  const errors = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl })
    return yield* Effect.all([
      Effect.flip(client.graph.expand.page({ start: [] as never })),
      Effect.flip(
        client.graph.path({
          source: { schema: "public", table: "entities", id: "a" },
          target: { schema: "public", table: "entities", id: "b" },
          maxDepth: 21,
        }),
      ),
      Effect.flip(client.text.tsvector.page({ query: "   ", config: "documents" })),
      Effect.flip(client.text.tsvector.page({ query: "x".repeat(2_001), config: "documents" })),
      Effect.flip(client.vector.search.page({ embedding: [Number.NaN] })),
      Effect.flip(client.graph.expand.page({ start: { schema: "public", table: "entities", id: 42 } as never })),
    ])
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(errors.every((error) => error instanceof PolygresError.InvalidInput)).toBe(true)
  expect(errors.every((error) => error instanceof PolygresError.InvalidInput && error.issues.length > 0)).toBe(true)
  expect(calls).toBe(0)
})

test("Python numeric adapters reject coercions that int and float reject", async () => {
  const http = HttpClient.make((request) => {
    const body = request.url.endsWith("/connection-info")
      ? {
          project_id: "p0123456789abcdef0123456",
          database: "postgres",
          username: "user",
          port: "2.0",
          direct: { host: "direct", connection_string_without_password: "postgres://direct" },
          pooled: { host: "pooled", connection_string_without_password: "postgres://pooled" },
        }
      : request.url.endsWith("/graph/expand")
        ? {
            results: [{ node: { schema: "public", table: "entities", id: "one" }, depth: "2e0", properties: {} }],
          }
        : {
            results: [
              {
                schema: "public",
                table: "documents",
                id: "one",
                properties: {},
                distance: "",
                score: 1,
              },
            ],
          }
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)))
  })
  const errors = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.all([
      Effect.flip(client.connectionInfo()),
      Effect.flip(client.graph.expand.page({ start: { schema: "public", table: "entities", id: "one" } })),
      Effect.flip(client.vector.search.page({ embedding: [0.1] })),
    ])
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(errors.every((error) => error instanceof PolygresError.InvalidResponse)).toBe(true)
})

test("configuration rejects unsafe Runtime URLs and invalid project modes", async () => {
  const http = HttpClient.make(() => Effect.never)
  for (const options of [
    { apiKey: key, runtimeUrl: "https://user:password@example.com/v1" },
    { apiKey: key, runtimeUrl: "https://example.com/v1?token=secret" },
    { apiKey: key, runtimeUrl, projectMode: "other" as never },
  ]) {
    const error = await Polygres.make(options).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.flip,
      Effect.runPromise,
    )
    expect(error).toBeInstanceOf(PolygresError.Configuration)
  }
})
