import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { Polygres, PolygresError } from "../src/index.js"

const key = "poly_live_0123456789abcdef0123456789abcdef"
const runtimeUrl = "https://p0123456789abcdef0123456.api.db.polygres.com/v1"

const failWith = (body: unknown, status: number) =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status }))),
    )
    const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    )
    return yield* Effect.flip(client.readiness())
  })

test("catalog status and variants override inconsistent HTTP responses", async () => {
  const authentication = await failWith(
    { error: { code: "API_KEY_INVALID", variant: "api_key_invalid", message: "untrusted" } },
    500,
  ).pipe(Effect.runPromise)
  expect(authentication).toBeInstanceOf(PolygresError.Authentication)
  if (authentication instanceof PolygresError.Authentication) {
    expect(authentication.status).toBe(401)
    expect(authentication.message).toBe("API key is invalid.")
  }

  const runtime = await failWith(
    {
      error: {
        code: "CONTEXT_CAPABILITY_UNAVAILABLE",
        variant: "project_s_context_runtime_schema_not",
      },
    },
    409,
  ).pipe(Effect.runPromise)
  expect(runtime).toBeInstanceOf(PolygresError.Server)
  if (runtime instanceof PolygresError.Server) {
    expect(runtime.status).toBe(503)
    expect(runtime.message).toBe("The project's Context runtime schema is not ready.")
  }
})

test("maintenance errors preserve only catalog-approved details", async () => {
  const error = await failWith(
    {
      error: {
        code: "MAINTENANCE_FULL",
        message: "untrusted",
        details: { mode: "full", start_at: "2026-09-02T00:00:00Z", internal: "hidden" },
      },
    },
    500,
  ).pipe(Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.Maintenance)
  if (error instanceof PolygresError.Maintenance) {
    expect(error.status).toBe(503)
    expect(error.message).toBe(
      "Polygres is temporarily unavailable for scheduled maintenance. Try again after the maintenance window.",
    )
    expect(error.details).toEqual({ mode: "full", start_at: "2026-09-02T00:00:00Z" })
  }
})

test("unknown HTTP 400 errors remain generic API failures", async () => {
  const error = await failWith(
    {
      error: {
        code: "FUTURE_ERROR",
        message: `Future failure ${key}`,
        details: { echoed: key },
      },
    },
    400,
  ).pipe(Effect.runPromise)

  expect(error).toBeInstanceOf(PolygresError.Api)
  if (error instanceof PolygresError.Api) {
    expect(error.status).toBe(400)
    expect(error.message).toBe("Future failure [REDACTED]")
    expect(error.details).toEqual({ echoed: "[REDACTED]" })
  }
})
