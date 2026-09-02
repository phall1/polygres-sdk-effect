import { expect, test } from "bun:test"
import { Duration, Effect, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import * as HttpTransport from "../src/internal/HttpTransport.js"
import * as PolygresError from "../src/PolygresError.js"

const apiKey = "poly_live_0123456789abcdef0123456789abcdef"
const config = (overrides: Partial<HttpTransport.Config> = {}): HttpTransport.Config => ({
  apiKey: Redacted.make(apiKey),
  baseUrl: "https://p0123456789abcdef0123456.api.db.polygres.com/v1",
  timeout: Duration.seconds(1),
  maxRetries: 0,
  headers: {},
  apiVersion: "2026-08-04",
  clientVersion: "0.3.0",
  ...overrides,
})

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, http: HttpClient.HttpClient) =>
  effect.pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

const bodyOf = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

test("transport preserves verbs, encoded query values, null bodies, and explicit success statuses", async () => {
  const observed: Array<Readonly<Record<string, unknown>>> = []
  const http = HttpClient.make((request) => {
    const url = new URL(request.url)
    observed.push({
      method: request.method,
      path: url.pathname,
      query: request.urlParams.params,
      body: bodyOf(request),
    })
    const status = request.method === "PATCH" ? 202 : 200
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ ok: true }, { status })))
  })

  await run(
    Effect.gen(function* () {
      const transport = yield* HttpTransport.make(config())
      for (const method of ["DELETE", "GET", "PATCH", "POST", "PUT"] as const) {
        yield* transport.request({
          operation: `test.${method}`,
          method,
          path: "/context/a value",
          query: { cursor: "a/b?c", limit: 10, enabled: false, absent: undefined, nullable: null },
          body: method === "GET" ? undefined : { explicit: null },
          retry: "never",
          expectedStatuses: method === "PATCH" ? [202] : [200],
        })
      }
    }),
    http,
  )

  expect(observed).toEqual(
    ["DELETE", "GET", "PATCH", "POST", "PUT"].map((method) => ({
      method,
      path: "/v1/context/a%20value",
      query: [
        ["cursor", "a/b?c"],
        ["limit", "10"],
        ["enabled", "false"],
      ],
      body: method === "GET" ? undefined : { explicit: null },
    })),
  )
})

test("idempotent mutation retries reuse one normalized key, body, and protected headers", async () => {
  const requests: Array<{
    readonly key: string | undefined
    readonly body: unknown
    readonly accept: string | undefined
    readonly contentType: string | undefined
  }> = []
  const http = HttpClient.make((request) => {
    requests.push({
      key: request.headers["idempotency-key"],
      body: bodyOf(request),
      accept: request.headers.accept,
      contentType: request.headers["content-type"],
    })
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        requests.length === 1
          ? Response.json({ error: { code: "FUTURE_TRANSIENT", message: "retry" } }, { status: 503 })
          : Response.json({ ok: true }),
      ),
    )
  })

  await run(
    Effect.gen(function* () {
      const transport = yield* HttpTransport.make(
        config({
          maxRetries: 1,
          headers: {
            accept: "text/plain",
            "content-type": "text/plain",
            "Idempotency-Key": "global-attacker",
          },
        }),
      )
      yield* transport.request({
        operation: "context.retryOperation",
        method: "POST",
        path: "/context/operations/one/retry",
        body: { stable: true },
        headers: { "IDEMPOTENCY-KEY": "caller-action-one" },
        retry: "idempotentMutation",
        expectedStatuses: [200],
      })
    }),
    http,
  )

  expect(requests).toEqual([
    {
      key: "caller-action-one",
      body: { stable: true },
      accept: "application/json",
      contentType: "application/json",
    },
    {
      key: "caller-action-one",
      body: { stable: true },
      accept: "application/json",
      contentType: "application/json",
    },
  ])
})

test("unsafe idempotent mutations and unexpected success statuses fail without dispatch", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ ok: true }, { status: 201 })))
  })

  const missingKey = await run(
    Effect.gen(function* () {
      const transport = yield* HttpTransport.make(config({ headers: { "Idempotency-Key": "global-attacker" } }))
      return yield* Effect.flip(
        transport.request({
          operation: "context.cancelOperation",
          method: "POST",
          path: "/context/operations/one/cancel",
          body: {},
          retry: "idempotentMutation",
        }),
      )
    }),
    http,
  )
  expect(missingKey).toBeInstanceOf(PolygresError.Transport)
  expect(calls).toBe(0)

  const unexpected = await run(
    Effect.gen(function* () {
      const transport = yield* HttpTransport.make(config())
      return yield* Effect.flip(
        transport.request({
          operation: "context.retryOperation",
          method: "POST",
          path: "/context/operations/one/retry",
          body: {},
          retry: "never",
          expectedStatuses: [202],
        }),
      )
    }),
    http,
  )
  expect(unexpected).toBeInstanceOf(PolygresError.Api)
  expect(calls).toBe(1)
})

test.each(["1e308", "Fri, 31 Dec 9999 23:59:59 GMT"])(
  "request budgets bound hostile Retry-After value %s",
  async (retryAfter) => {
    let calls = 0
    const http = HttpClient.make((request) => {
      calls++
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            { error: { code: "FUTURE_TRANSIENT", message: "retry later" } },
            { status: 503, headers: { "retry-after": retryAfter } },
          ),
        ),
      )
    })

    const error = await run(
      Effect.gen(function* () {
        const transport = yield* HttpTransport.make(config({ maxRetries: 1 }))
        return yield* Effect.flip(
          transport.request({
            operation: "bounded.read",
            method: "GET",
            path: "/context/capabilities",
            retry: "readOnly",
            budget: Duration.millis(5),
          }),
        )
      }),
      http,
    )

    expect(error).toBeInstanceOf(PolygresError.RequestTimeout)
    if (error instanceof PolygresError.RequestTimeout) expect(error.kind).toBe("deadline")
    expect(calls).toBe(1)
  },
)
