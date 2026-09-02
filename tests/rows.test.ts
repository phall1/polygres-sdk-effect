import { expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { Polygres, PolygresError, Rows } from "../src/index.js"

const key = "poly_live_0123456789abcdef0123456789abcdef"
const runtimeUrl = "https://p0123456789abcdef0123456.api.db.polygres.com/v1"
const collectionId = "2e172638-bd77-4a2c-bc42-406f4f2938d7"
const operationId = "68b54789-f795-4127-989b-7895d1608836"

type Request = Parameters<Parameters<typeof HttpClient.make>[0]>[0]

const bodyOf = (request: Request): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

const writeResult = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  operation: "inserted",
  schema: "public",
  table: "memories",
  returned: {},
  status: "completed",
  row_committed: true,
  context: null,
  idempotency_key: null,
  request_id: "req_rows",
  ...overrides,
})

const contextOperation = (status: "succeeded" | "failed") => ({
  id: operationId,
  collection_id: collectionId,
  kind: "points_upsert",
  status,
  stage: status === "succeeded" ? "completed" : "failed",
  processed_units: 1,
  total_units: 1,
  attempts: 1,
  retry_until: "2026-09-02T13:00:00Z",
  error: null,
  created_at: "2026-09-02T12:00:00Z",
  started_at: "2026-09-02T12:00:01Z",
  finished_at: "2026-09-02T12:00:02Z",
  updated_at: "2026-09-02T12:00:02Z",
})

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, http: HttpClient.HttpClient) =>
  effect.pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.runPromise)

test("all row methods use object inputs and exact routes, bodies, defaults, and headers", async () => {
  const requests: Array<{ path: string; body: unknown; idempotencyKey?: string }> = []
  const http = HttpClient.make((request) => {
    const path = new URL(request.url).pathname
    requests.push({
      path,
      body: bodyOf(request),
      ...(request.headers["idempotency-key"] === undefined
        ? {}
        : { idempotencyKey: request.headers["idempotency-key"] }),
    })
    const response = path.endsWith("/validate")
      ? {
          valid: true,
          operation: "insert",
          schema: "public",
          table: "memories",
          writable_columns: ["id"],
          conflict_constraint: null,
          context: null,
          request_id: "req_validate",
        }
      : writeResult({
          operation: requests.length === 3 ? "upserted" : requests.length === 4 ? "ignored" : "inserted",
          ...(requests.length === 3
            ? {
                idempotency_key: "memory-one",
                context: {
                  collection_id: collectionId,
                  status: "completed",
                  operation_id: null,
                  operation_status: "succeeded",
                  retry_until: null,
                  error: null,
                },
              }
            : {}),
        })
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(response)))
  })

  const results = await run(
    Effect.gen(function* () {
      const client = yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })
      const validation = yield* client.rows.validate({ schema: "public", table: "memories", row: { id: "one" } })
      const inserted = yield* client.rows.insert({
        schema: "public",
        table: "memories",
        row: { id: "one" },
      })
      const upserted = yield* client.rows.upsert({
        schema: "public",
        table: "memories",
        row: { id: "one", content: "hello" },
        conflictColumns: ["id"],
        updateColumns: ["content"],
        returning: ["id"],
        contextCollectionId: collectionId,
        idempotencyKey: "memory-one",
      })
      const ignored = yield* client.rows.ignore({
        schema: "public",
        table: "memories",
        row: { id: "one" },
        conflictColumns: ["id"],
      })
      return { validation, inserted, upserted, ignored }
    }),
    http,
  )

  expect(requests).toEqual([
    {
      path: "/v1/tables/public/memories/rows/validate",
      body: { mode: "insert", row: { id: "one" }, returning: [] },
    },
    {
      path: "/v1/tables/public/memories/rows",
      body: { mode: "insert", row: { id: "one" }, returning: [] },
    },
    {
      path: "/v1/tables/public/memories/rows",
      body: {
        mode: "upsert",
        row: { id: "one", content: "hello" },
        returning: ["id"],
        conflict_columns: ["id"],
        update_columns: ["content"],
        context: { reconcile: true, collection_id: collectionId },
      },
      idempotencyKey: "memory-one",
    },
    {
      path: "/v1/tables/public/memories/rows",
      body: { mode: "ignore", row: { id: "one" }, returning: [], conflict_columns: ["id"] },
    },
  ])
  expect(results.validation.writableColumns).toEqual(["id"])
  expect(results.validation.requestId).toBe("req_validate")
  expect(results.inserted.rowCommitted).toBe(true)
  expect(results.upserted.operation).toBe("upserted")
  expect(results.ignored.operation).toBe("ignored")
  expect("row_committed" in results.inserted).toBe(false)
})

test("row validation safely retries while execution never does", async () => {
  let validationCalls = 0
  const http = HttpClient.make((request) => {
    validationCalls++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        validationCalls === 1
          ? Response.json({ error: { code: "RUNTIME_TRANSIENT" } }, { status: 503 })
          : Response.json({
              valid: true,
              operation: "insert",
              schema: "public",
              table: "memories",
              writable_columns: ["id"],
              conflict_constraint: null,
              request_id: "req_validate",
            }),
      ),
    )
  })

  const result = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 1 })).rows
      return yield* rows.validate({ schema: "public", table: "memories", row: { id: "one" } })
    }),
    http,
  )

  expect(result.valid).toBe(true)
  expect(validationCalls).toBe(2)
})

test("row preflight rejects invalid JSON, identifiers, modes, idempotency, and wait timeouts", async () => {
  let calls = 0
  const http = HttpClient.make((request) => {
    calls++
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(writeResult())))
  })
  const errors = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl })).rows
      return yield* Effect.all([
        Effect.flip(rows.insert({ schema: "bad-name", table: "memories", row: { id: "one" } })),
        Effect.flip(rows.insert({ schema: "public", table: "memories", row: { createdAt: new Date() } as never })),
        Effect.flip(rows.upsert({ schema: "public", table: "memories", row: { id: "one" }, conflictColumns: [] })),
        Effect.flip(
          rows.insert({
            schema: "public",
            table: "memories",
            row: { id: "one" },
            reconcileContext: true,
          }),
        ),
        Effect.flip(
          rows.insert({
            schema: "public",
            table: "memories",
            row: { id: "one" },
            idempotencyKey: "orphan",
          }),
        ),
        Effect.flip(
          rows.insert({
            schema: "public",
            table: "memories",
            row: { id: "one" },
            reconcileContext: true,
            idempotencyKey: "memory-one",
            waitForContext: true,
            waitTimeout: Number.NaN,
          }),
        ),
        Effect.flip(
          rows.validate({
            schema: "public",
            table: "memories",
            row: { id: "one" },
            mode: "ignore",
          }),
        ),
      ])
    }),
    http,
  )

  expect(errors.every((error) => error instanceof PolygresError.InvalidInput)).toBe(true)
  expect(calls).toBe(0)
})

test("writes classify uncertain outcomes without duplicate attempts and preserve known failures", async () => {
  for (const scenario of [
    { status: 503, code: "ROW_WRITE_OUTCOME_AMBIGUOUS", ambiguous: true },
    { status: 500, code: "FUTURE_RUNTIME_FAILURE", ambiguous: true },
    { status: 500, code: "ROW_WRITE_FAILED", ambiguous: false },
  ] as const) {
    let calls = 0
    const http = HttpClient.make((request) => {
      calls++
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            {
              request_id: key,
              error: { code: scenario.code, message: `unsafe ${key}`, details: { echoed: key } },
            },
            { status: scenario.status },
          ),
        ),
      )
    })
    const error = await run(
      Effect.gen(function* () {
        const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 5 })).rows
        return yield* Effect.flip(rows.insert({ schema: "public", table: "memories", row: { id: "one" } }))
      }),
      http,
    )

    expect(error instanceof PolygresError.AmbiguousWrite).toBe(scenario.ambiguous)
    expect(calls).toBe(1)
    expect(JSON.stringify(error)).not.toContain(key)
    if (error instanceof PolygresError.AmbiguousWrite) {
      expect(error.code).toBe(scenario.code)
      expect(error.status).toBe(scenario.status === 500 && scenario.code.startsWith("FUTURE") ? 500 : 503)
    }
  }
})

test("transport failures and attempt timeouts become ambiguous writes without retry", async () => {
  for (const failure of [
    Effect.fail({ _tag: "RequestError", code: "ECONNRESET", message: key } as never),
    Effect.never,
  ]) {
    let calls = 0
    const http = HttpClient.make(() => {
      calls++
      return failure
    })
    const error = await run(
      Effect.gen(function* () {
        const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 5, timeout: "1 millis" })).rows
        return yield* Effect.flip(rows.insert({ schema: "public", table: "memories", row: { id: "one" } }))
      }),
      http,
    )

    expect(error).toBeInstanceOf(PolygresError.AmbiguousWrite)
    expect(calls).toBe(1)
    expect(JSON.stringify(error)).not.toContain(key)
  }
})

test("an operation deadline during dispatch is an ambiguous single-attempt write", async () => {
  let calls = 0
  const http = HttpClient.make(() => {
    calls++
    return Effect.never
  })
  const error = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({
        apiKey: key,
        runtimeUrl,
        maxRetries: 5,
        timeout: "1 second",
        deadline: "1 millis",
      })).rows
      return yield* Effect.flip(rows.insert({ schema: "public", table: "memories", row: { id: "one" } }))
    }),
    http,
  )

  expect(error).toBeInstanceOf(PolygresError.AmbiguousWrite)
  expect(calls).toBe(1)
})

test("a successful Context wait replays once with the same idempotency key", async () => {
  const requests: Array<{ path: string; idempotencyKey?: string }> = []
  const http = HttpClient.make((request) => {
    const path = new URL(request.url).pathname
    requests.push({
      path,
      ...(request.headers["idempotency-key"] === undefined
        ? {}
        : { idempotencyKey: request.headers["idempotency-key"] }),
    })
    if (path.includes("/context/operations/")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            operation: contextOperation("succeeded"),
            request_id: "req_operation",
          }),
        ),
      )
    }
    const firstWrite = requests.filter((item) => item.path.endsWith("/rows")).length === 1
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          firstWrite
            ? writeResult({
                status: "pending",
                idempotency_key: "memory-one",
                context: {
                  collection_id: collectionId,
                  status: "pending",
                  operation_id: operationId,
                  operation_status: "queued",
                  retry_until: null,
                  error: null,
                },
              })
            : writeResult({
                idempotency_key: "memory-one",
                context: {
                  collection_id: collectionId,
                  status: "completed",
                  operation_id: operationId,
                  operation_status: "succeeded",
                  retry_until: null,
                  error: null,
                },
              }),
        ),
      ),
    )
  })

  const result = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* rows.insert({
        schema: "public",
        table: "memories",
        row: { id: "one" },
        reconcileContext: true,
        idempotencyKey: "memory-one",
        waitForContext: true,
      })
    }),
    http,
  )

  expect(result.status).toBe("completed")
  expect(requests).toEqual([
    { path: "/v1/tables/public/memories/rows", idempotencyKey: "memory-one" },
    { path: `/v1/context/operations/${operationId}` },
    { path: "/v1/tables/public/memories/rows", idempotencyKey: "memory-one" },
  ])
})

test("waiting rejects a pending reconciliation without an operation ID", async () => {
  let requests = 0
  const http = HttpClient.make((request) => {
    requests++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            status: "pending",
            idempotency_key: "memory-one",
            context: {
              collection_id: collectionId,
              status: "pending",
              operation_id: null,
              operation_status: "queued",
              retry_until: null,
              error: null,
            },
          }),
        ),
      ),
    )
  })

  const error = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* Effect.flip(
        rows.insert({
          schema: "public",
          table: "memories",
          row: { id: "one" },
          reconcileContext: true,
          idempotencyKey: "memory-one",
          waitForContext: true,
        }),
      )
    }),
    http,
  )

  expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
  expect(requests).toBe(1)
})

test("terminal replay is bound to the operation that was observed", async () => {
  const otherOperationId = "78b54789-f795-4127-989b-7895d1608836"
  let writes = 0
  const http = HttpClient.make((request) => {
    if (request.url.includes("/context/operations/")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ operation: contextOperation("succeeded"), request_id: "req_operation" }),
        ),
      )
    }
    writes++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            status: writes === 1 ? "pending" : "completed",
            idempotency_key: "memory-one",
            context: {
              collection_id: collectionId,
              status: writes === 1 ? "pending" : "completed",
              operation_id: writes === 1 ? operationId : otherOperationId,
              operation_status: writes === 1 ? "queued" : "succeeded",
              retry_until: null,
              error: null,
            },
          }),
        ),
      ),
    )
  })

  const error = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* Effect.flip(
        rows.insert({
          schema: "public",
          table: "memories",
          row: { id: "one" },
          reconcileContext: true,
          idempotencyKey: "memory-one",
          waitForContext: true,
        }),
      )
    }),
    http,
  )

  expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
  expect(writes).toBe(2)
})

test("terminal Context failure returns a typed partial result without replay", async () => {
  let writes = 0
  const http = HttpClient.make((request) => {
    const path = new URL(request.url).pathname
    if (path.includes("/context/operations/")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            operation: contextOperation("failed"),
            request_id: "req_operation",
          }),
        ),
      )
    }
    writes++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            status: "pending",
            idempotency_key: "memory-one",
            context: {
              collection_id: collectionId,
              status: "pending",
              operation_id: operationId,
              operation_status: "queued",
              retry_until: null,
              error: null,
            },
          }),
        ),
      ),
    )
  })

  const result = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* rows.insert({
        schema: "public",
        table: "memories",
        row: { id: "one" },
        reconcileContext: true,
        idempotencyKey: "memory-one",
        waitForContext: true,
      })
    }),
    http,
  )

  expect(writes).toBe(1)
  expect(result.status).toBe("partial_failed")
  const context = Option.getOrThrow(result.context)
  expect(context.status).toBe("partial_failed")
  expect(Option.getOrThrow(context.operationStatus)).toBe("failed")
  expect(Option.getOrThrow(context.error)).toEqual({
    code: "ROW_CONTEXT_RECONCILIATION_FAILED",
    message: "The row committed, but Context reconciliation failed.",
    retryable: true,
    details: { operation_id: operationId, underlying_code: "CONTEXT_OPERATION_FAILED" },
  })
})

test("Context reconciliation rejects an operation envelope for a different ID", async () => {
  const otherOperationId = "78b54789-f795-4127-989b-7895d1608836"
  const http = HttpClient.make((request) => {
    if (request.url.includes("/context/operations/")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            operation: { ...contextOperation("succeeded"), id: otherOperationId },
            request_id: "req_operation",
          }),
        ),
      )
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            status: "pending",
            idempotency_key: "memory-one",
            context: {
              collection_id: collectionId,
              status: "pending",
              operation_id: operationId,
              operation_status: "queued",
              retry_until: null,
              error: null,
            },
          }),
        ),
      ),
    )
  })

  const error = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* Effect.flip(
        rows.insert({
          schema: "public",
          table: "memories",
          row: { id: "one" },
          reconcileContext: true,
          idempotencyKey: "memory-one",
          waitForContext: true,
        }),
      )
    }),
    http,
  )

  expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
})

test("Context polling uncertainty preserves redacted recovery identifiers", async () => {
  let writes = 0
  const http = HttpClient.make((request) => {
    if (request.url.includes("/context/operations/")) {
      return Effect.fail({ _tag: "RequestError", code: "ECONNRESET", message: key } as never)
    }
    writes++
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            request_id: key,
            status: "pending",
            idempotency_key: key,
            context: {
              collection_id: collectionId,
              status: "pending",
              operation_id: operationId,
              operation_status: "queued",
              retry_until: null,
              error: null,
            },
          }),
        ),
      ),
    )
  })

  const error = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* Effect.flip(
        rows.insert({
          schema: "public",
          table: "memories",
          row: { id: "one" },
          reconcileContext: true,
          idempotencyKey: key,
          waitForContext: true,
        }),
      )
    }),
    http,
  )

  expect(error).toBeInstanceOf(PolygresError.Transport)
  expect(writes).toBe(1)
  if (error instanceof PolygresError.Transport) {
    expect(error.details).toEqual({
      operation_id: operationId,
      idempotency_key: "[REDACTED]",
      row_request_id: "[REDACTED]",
    })
    expect(JSON.stringify(error)).not.toContain(key)
  }
})

test("replay uncertainty is not reported as an ambiguous original write", async () => {
  const scenarios = ["transport", "timeout", "server"] as const
  for (const scenario of scenarios) {
    let writes = 0
    const http = HttpClient.make((request) => {
      if (request.url.includes("/context/operations/")) {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ operation: contextOperation("succeeded"), request_id: "req_operation" }),
          ),
        )
      }
      writes++
      if (writes === 1) {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(
              writeResult({
                status: "pending",
                idempotency_key: "memory-one",
                context: {
                  collection_id: collectionId,
                  status: "pending",
                  operation_id: operationId,
                  operation_status: "queued",
                  retry_until: null,
                  error: null,
                },
              }),
            ),
          ),
        )
      }
      if (scenario === "transport") {
        return Effect.fail({ _tag: "RequestError", code: "ECONNRESET" } as never)
      }
      if (scenario === "timeout") return Effect.never
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ error: { code: "FUTURE_FAILURE", message: "unknown" } }, { status: 503 }),
        ),
      )
    })

    const error = await run(
      Effect.gen(function* () {
        const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0, timeout: "5 millis" })).rows
        return yield* Effect.flip(
          rows.insert({
            schema: "public",
            table: "memories",
            row: { id: "one" },
            reconcileContext: true,
            idempotencyKey: "memory-one",
            waitForContext: true,
          }),
        )
      }),
      http,
    )

    expect(error).not.toBeInstanceOf(PolygresError.AmbiguousWrite)
    expect(writes).toBe(2)
    if ("details" in error) {
      expect(error.details).toEqual({
        operation_id: operationId,
        idempotency_key: "memory-one",
        row_request_id: "req_rows",
      })
    }
  }
})

test("row responses are bound to target, operation, key, and Context collection", async () => {
  const mismatches: ReadonlyArray<Readonly<Record<string, unknown>>> = [
    { schema: "other" },
    { table: "other" },
    { operation: "ignored" },
    { idempotency_key: "different" },
    {
      context: {
        collection_id: "3e172638-bd77-4a2c-bc42-406f4f2938d7",
        status: "completed",
        operation_id: null,
        operation_status: "succeeded",
        retry_until: null,
        error: null,
      },
    },
  ]
  for (const mismatch of mismatches) {
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            writeResult({
              idempotency_key: "memory-one",
              context: {
                collection_id: collectionId,
                status: "completed",
                operation_id: null,
                operation_status: "succeeded",
                retry_until: null,
                error: null,
              },
              ...mismatch,
            }),
          ),
        ),
      ),
    )
    const error = await run(
      Effect.gen(function* () {
        const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
        return yield* Effect.flip(
          rows.insert({
            schema: "public",
            table: "memories",
            row: { id: "one" },
            reconcileContext: true,
            contextCollectionId: collectionId,
            idempotencyKey: "memory-one",
          }),
        )
      }),
      http,
    )
    expect(error).toBeInstanceOf(PolygresError.InvalidResponse)
  }
})

test("server-side Context operation timeout becomes a sanitized partial failure", async () => {
  const http = HttpClient.make((request) => {
    if (request.url.includes("/context/operations/")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            operation: {
              ...contextOperation("failed"),
              error: {
                code: "CONTEXT_OPERATION_TIMED_OUT",
                message: key,
                details: { operation_id: operationId, unsafe: key },
                http_status: 504,
                variant: null,
              },
            },
            request_id: "req_operation",
          }),
        ),
      )
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            status: "pending",
            idempotency_key: "memory-one",
            context: {
              collection_id: collectionId,
              status: "pending",
              operation_id: operationId,
              operation_status: "queued",
              retry_until: null,
              error: null,
            },
          }),
        ),
      ),
    )
  })

  const result = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* rows.insert({
        schema: "public",
        table: "memories",
        row: { id: "one" },
        reconcileContext: true,
        idempotencyKey: "memory-one",
        waitForContext: true,
      })
    }),
    http,
  )

  expect(result.status).toBe("partial_failed")
  expect(Option.getOrThrow(Option.getOrThrow(result.context).error)).toEqual({
    code: "ROW_CONTEXT_RECONCILIATION_FAILED",
    message: "The row committed, but Context reconciliation failed.",
    retryable: true,
    details: { operation_id: operationId, underlying_code: "CONTEXT_OPERATION_TIMED_OUT" },
  })
  expect(JSON.stringify(result)).not.toContain(key)
})

test("embedded Context diagnostics are sanitized without modifying returned row data", async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          writeResult({
            returned: { preserved: key },
            status: "partial_failed",
            idempotency_key: "memory-one",
            context: {
              collection_id: collectionId,
              status: "partial_failed",
              operation_id: operationId,
              operation_status: "failed",
              retry_until: null,
              error: { code: "FAILURE", message: key, retryable: false, details: { reflected: key } },
            },
          }),
        ),
      ),
    ),
  )
  const result = await run(
    Effect.gen(function* () {
      const rows = (yield* Polygres.make({ apiKey: key, runtimeUrl, maxRetries: 0 })).rows
      return yield* rows.insert({
        schema: "public",
        table: "memories",
        row: { id: "one" },
        reconcileContext: true,
        contextCollectionId: collectionId,
        idempotencyKey: "memory-one",
      })
    }),
    http,
  )

  expect(result.returned).toEqual({ preserved: key })
  expect(Option.getOrThrow(Option.getOrThrow(result.context).error)).toEqual({
    code: "FAILURE",
    message: "[REDACTED]",
    retryable: false,
    details: { reflected: "[REDACTED]" },
  })
})

test("public row schemas retain required request IDs and UUID formats", () => {
  const valid = {
    operation: "inserted" as const,
    schema: "public",
    table: "memories",
    returned: {},
    status: "completed" as const,
    rowCommitted: true as const,
    context: Option.none(),
    idempotencyKey: Option.none(),
    requestId: "req_rows",
  }
  expect(Schema.decodeUnknownSync(Rows.WriteResult)(valid).requestId).toBe("req_rows")
  expect(() => Schema.decodeUnknownSync(Rows.WriteResult)({ ...valid, requestId: undefined })).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Rows.WriteResult)({
      ...valid,
      context: Option.some({
        collectionId: "not-a-uuid",
        status: "completed",
        operationId: Option.none(),
        operationStatus: Option.none(),
        retryUntil: Option.none(),
        error: Option.none(),
      }),
    }),
  ).toThrow()
})
