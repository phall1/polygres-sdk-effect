import { expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import {
  API_VERSION,
  make,
  PolygresAuthError,
  PolygresClient,
  PolygresConfigError,
  PolygresMaintenanceError,
  PolygresTransportError,
} from "../src/index.js"

const key = "poly_live_0123456789abcdef0123456789abcdef"
const runtimeUrl = "https://p0123456789abcdef0123456.api.db.polygres.com/v1"

test("readiness uses protected headers and decodes the response", async () => {
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
    const client = yield* make({
      apiKey: Redacted.make(key),
      runtimeUrl,
      maxRetries: 0,
      headers: { authorization: "Bearer attacker", "x-custom": "kept" },
    })
    return yield* client.readiness()
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(observed).toEqual({
    authorization: `Bearer ${key}`,
    apiVersion: API_VERSION,
    url: `${runtimeUrl}/retrieval/readiness`,
  })
  expect(result.vector.default_config).toBe("documents")
})

test("vector search serializes wire names and returns a typed page", async () => {
  let body: unknown
  const http = HttpClient.make((request) => {
    body = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          request_id: "req_vector",
          results: [
            {
              schema: "public",
              table: "documents",
              id: "doc_1",
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
  const result = await Effect.gen(function* () {
    const client = yield* make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* client.vector.search([0.1, 0.2], {
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
  expect(result.results[0]?.score).toBe(0.9)
  expect(result.requestId).toBe("req_vector")
})

test("maps API failures without retaining secrets", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          {
            request_id: "req_auth",
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
  const result = await Effect.gen(function* () {
    const client = yield* make({ apiKey: key, runtimeUrl, maxRetries: 0 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(result).toBeInstanceOf(PolygresAuthError)
  expect(JSON.stringify(result)).not.toContain(key)
  if (result instanceof PolygresAuthError) {
    expect(result.requestId).toBe("req_auth")
    expect(result.details).toEqual({})
  }
})

test("invalid configuration fails in the typed channel", async () => {
  const http = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}))))
  const exit = await make({ apiKey: "bad", projectId: "p0123456789abcdef0123456" }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.exit,
    Effect.runPromise,
  )
  expect(exit._tag).toBe("Failure")
  expect(String(exit)).toContain(PolygresConfigError.name)
})

test("service layer composes with HttpClient", async () => {
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
    const client = yield* PolygresClient
    return yield* client.readiness()
  }).pipe(
    Effect.provideServiceEffect(PolygresClient, make({ apiKey: key, runtimeUrl, maxRetries: 0 })),
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.runPromise,
  )
  expect(result.graph.ready).toBe(false)
})

test("retries transient responses within the operation budget", async () => {
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
    const client = yield* make({ apiKey: key, runtimeUrl, maxRetries: 1 })
    return yield* client.readiness()
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(result.graph.ready).toBe(true)
  expect(calls).toBe(2)
})

test("never retries maintenance responses", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          {
            request_id: "req_maintenance",
            error: { code: "MAINTENANCE_FULL", message: "untrusted" },
          },
          { status: 503 },
        ),
      ),
    )
  })
  const error = await Effect.gen(function* () {
    const client = yield* make({ apiKey: key, runtimeUrl, maxRetries: 2 })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresMaintenanceError)
  expect(calls).toBe(1)
})

test("timeout covers the complete retry operation", async () => {
  const http = HttpClient.make(() => Effect.never)
  const error = await Effect.gen(function* () {
    const client = yield* make({ apiKey: key, runtimeUrl, maxRetries: 2, timeout: "1 millis" })
    return yield* Effect.flip(client.readiness())
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresTransportError)
  if (error instanceof PolygresTransportError) expect(error.reason).toBe("timeout")
})

test("validates requests before touching the transport", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({})))
  })
  const error = await Effect.gen(function* () {
    const client = yield* make({ apiKey: key, runtimeUrl })
    return yield* Effect.flip(
      client.vector.search([0.1], {
        maxDistance: 1,
        minSimilarity: 0.5,
      }),
    )
  }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresConfigError)
  expect(calls).toBe(0)
})
