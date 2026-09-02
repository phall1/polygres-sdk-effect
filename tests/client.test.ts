import { expect, test } from "bun:test"
import { Effect, Option, Redacted, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { Polygres, PolygresError } from "../src/index.js"

const key = "poly_live_0123456789abcdef0123456789abcdef"
const runtimeUrl = "https://p0123456789abcdef0123456.api.db.polygres.com/v1"

const bodyOf = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

test("readiness protects headers and returns a camelCase domain model", async () => {
  let observed:
    | { readonly authorization: string | undefined; readonly apiVersion: string | undefined; readonly url: string }
    | undefined
  const http = HttpClient.make((request) => {
    observed = {
      authorization: request.headers.authorization,
      apiVersion: request.headers["x-polygres-api-version"],
      url: request.url,
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          request_id: "req_ready",
          project_id: "p0123456789abcdef0123456",
          graph: { ready: true },
          vector: { ready: true, default_config: "documents" },
          hybrid: { ready: true },
        }),
      ),
    )
  })
  const result = await Effect.gen(function* () {
    const client = yield* Polygres.make({
      apiKey: Redacted.make(key),
      runtimeUrl,
      maxRetries: 0,
      headers: { authorization: "Bearer attacker" },
    })
    return yield* client.readiness()
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(observed).toEqual({
    authorization: `Bearer ${key}`,
    apiVersion: Polygres.API_VERSION,
    url: `${runtimeUrl}/retrieval/readiness`,
  })
  expect(result.projectId).toBe("p0123456789abcdef0123456")
  expect(Option.getOrUndefined(result.vector.defaultConfig)).toBe("documents")
  expect(Option.getOrUndefined(result.requestId)).toBe("req_ready")
  expect("project_id" in result).toBe(false)
})

test("vector page uses one object input and normalizes numeric wire values", async () => {
  let body: unknown
  const http = HttpClient.make((request) => {
    body = bodyOf(request)
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          request_id: "req_vector",
          results: [
            {
              schema: "public",
              table: "documents",
              id: 1,
              properties: { title: "A" },
              distance: "0.1",
              similarity: "0.9",
              score: "0.9",
            },
          ],
          next_cursor: null,
          has_more: false,
        }),
      ),
    )
  })
  const page = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.vector.search.page({
      embedding: [0.1, 0.2],
      config: "documents",
      minSimilarity: 0.8,
      includeValues: true,
    })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(body).toEqual({
    embedding: [0.1, 0.2],
    config: "documents",
    filters: {},
    min_similarity: 0.8,
    include_values: true,
  })
  expect(page.items[0]?.id).toBe("1")
  expect(Option.getOrUndefined(page.items[0]?.score ?? Option.none())).toBe(0.9)
  expect(Option.isNone(page.nextCursor)).toBe(true)
})

test("operation streams are cold, cursor-aware, and stop when downstream stops", async () => {
  const cursors: Array<string | undefined> = []
  const http = HttpClient.make((request) => {
    const body = bodyOf(request) as { readonly cursor?: string }
    cursors.push(body.cursor)
    const first = body.cursor === undefined
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          results: [
            {
              schema: "public",
              table: "documents",
              id: first ? "one" : "two",
              properties: {},
              distance: null,
              score: 1,
            },
          ],
          next_cursor: first ? "second" : null,
          has_more: first,
        }),
      ),
    )
  })
  const values = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    const stream = client.vector.search.stream({ embedding: [0.1] })
    expect(cursors).toEqual([])
    return yield* stream.pipe(Stream.take(2), Stream.runCollect)
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(Array.from(values, (value) => value.id)).toEqual(["one", "two"])
  expect(cursors).toEqual([undefined, "second"])
})

test("API failures are domain-qualified and secret-safe", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          {
            request_id: key,
            error: {
              code: "API_KEY_INVALID",
              message: `invalid ${key}`,
              details: { api_key: key, hint: `do not print ${key}` },
            },
          },
          { status: 401 },
        ),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.Authentication)
  expect(error._tag).toBe("Polygres.Authentication")
  expect(JSON.stringify(error)).not.toContain(key)
})

test("invalid construction fails in the configuration channel", async () => {
  const http = HttpClient.make(() => Effect.never)
  const error = await Polygres.make({ apiKey: "bad", projectId: "p0123456789abcdef0123456" }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.flip,
    Effect.runPromise,
  )
  expect(error).toBeInstanceOf(PolygresError.Configuration)
})

test("the client service composes through its dependency-preserving Layer", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          project_id: "p0123456789abcdef0123456",
          graph: { ready: false },
          vector: { ready: false },
          hybrid: { ready: false },
        }),
      ),
    ),
  )
  const result = await Effect.gen(function* () {
    const client = yield* Polygres.Client
    return yield* client.readiness()
  }).pipe(
    Effect.provide(Polygres.layer({ apiKey: key, runtimeUrl, maxRetries: 0 })),
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.runPromise,
  )
  expect(result.graph.ready).toBe(false)
})

test("transient reads honor Retry-After before another timed attempt", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        calls === 1
          ? Response.json({ error: { code: "RUNTIME_TRANSIENT" } }, { status: 503, headers: { "retry-after": "0" } })
          : Response.json({
              project_id: "p0123456789abcdef0123456",
              graph: { ready: true },
              vector: { ready: true },
              hybrid: { ready: true },
            }),
      ),
    )
  })
  const result = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 1 })
    return yield* client.readiness()
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(result.graph.ready).toBe(true)
  expect(calls).toBe(2)
})

test("maintenance failures are never retried", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ error: { code: "MAINTENANCE_FULL" } }, { status: 503 })),
    )
  })
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 2 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.Maintenance)
  expect(calls).toBe(1)
})

test("timeout applies independently to each network attempt", async () => {
  let calls = 0
  const http = HttpClient.make(() => {
    calls++
    return Effect.never
  })
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 2, timeout: "1 millis" })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.RequestTimeout)
  if (error instanceof PolygresError.RequestTimeout) expect(error.kind).toBe("attempt")
  expect(calls).toBe(3)
})

test("schema-owned inputs fail before transport", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({})))
  })
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl })
    return yield* Effect.flip(
      client.vector.search.page({
        embedding: [0.1],
        maxDistance: 1,
        minSimilarity: 0.5,
      }),
    )
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.InvalidInput)
  expect(calls).toBe(0)
})

test("graph path and connection never leak search-only fields", async () => {
  const bodies: unknown[] = []
  const http = HttpClient.make((request) => {
    bodies.push(bodyOf(request))
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        request.url.endsWith("/path") ? Response.json({ paths: [] }) : Response.json({ connections: [] }),
      ),
    )
  })
  await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    const source = { schema: "public", table: "entities", id: "a" } as const
    const target = { schema: "public", table: "entities", id: "b" } as const
    yield* client.graph.path({ source, target })
    yield* client.graph.connection({ entities: [source, target] })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(bodies).toEqual([
    {
      source: { schema: "public", table: "entities", id: "a" },
      target: { schema: "public", table: "entities", id: "b" },
      max_depth: 5,
      direction: "any",
    },
    {
      entities: [
        { schema: "public", table: "entities", id: "a" },
        { schema: "public", table: "entities", id: "b" },
      ],
      max_depth: 5,
      direction: "any",
    },
  ])
})

test("nested null filter values are preserved", async () => {
  let body: unknown
  const http = HttpClient.make((request) => {
    body = bodyOf(request)
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ results: [], next_cursor: null, has_more: false })),
    )
  })
  await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    yield* client.vector.search.page({ embedding: [0.1], filters: { deleted_at: null } })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(body).toMatchObject({ filters: { deleted_at: null } })
})

test("hybrid wire variants normalize to one required result model", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          results: [
            {
              node: { schema: "public", table: "documents", id: "doc_1", properties: { title: "A" } },
              final_score: "0.75",
            },
          ],
          next_cursor: null,
          has_more: false,
          mode: "graph-first",
          rrf_k: 60,
        }),
      ),
    ),
  )
  const page = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.hybrid.graphFirst.page({
      start: { schema: "public", table: "documents", id: "doc_1" },
      embedding: [0.1],
    })
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(page.items[0]).toMatchObject({
    schema: "public",
    table: "documents",
    id: "doc_1",
    properties: { title: "A" },
    score: 0.75,
  })
  expect(page.metadata).toEqual({ mode: "graph-first", rrf_k: 60 })
})

test("non-finite ranked values become InvalidResponse", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          results: [
            {
              schema: "public",
              table: "documents",
              id: "doc_1",
              properties: {},
              distance: "NaN",
              score: "Infinity",
            },
          ],
          next_cursor: null,
          has_more: false,
        }),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.vector.search.page({ embedding: [0.1] }))
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
})

test("invalid durations fail during construction without defects", async () => {
  const http = HttpClient.make(() => Effect.never)
  for (const timeout of ["garbage", 0, -1] as const) {
    const error = await Polygres.make({ apiKey: key, runtimeUrl, timeout: timeout as never }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.flip,
      Effect.runPromise,
    )
    expect(error).toBeInstanceOf(PolygresError.Configuration)
  }
})

test("connection metadata fails closed for synchronized projects", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          project_id: "p0123456789abcdef0123456",
          project: { project_mode: "synced" },
          database: "postgres",
          username: "user",
          port: 5432,
          direct: { host: "direct", connection_string_without_password: "postgres://direct" },
          pooled: { host: "pooled", connection_string_without_password: "postgres://pooled" },
        }),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.connectionInfo())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.PermissionDenied)
})

test("non-JSON server failures are mapped by status", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response("bad gateway", { status: 502 }))),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.Server)
})

test("transport failures preserve only safe structured diagnostics", async () => {
  const http = HttpClient.make(() =>
    Effect.fail({ _tag: "RequestError", code: "ECONNRESET", message: `unsafe ${key}` } as never),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.Transport)
  if (error instanceof PolygresError.Transport) {
    expect(error.reason).toBe("request")
    expect(error.diagnostic).toBe("RequestError:ECONNRESET")
    expect(JSON.stringify(error)).not.toContain(key)
  }
})
