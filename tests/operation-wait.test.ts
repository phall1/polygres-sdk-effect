import { expect, test } from "bun:test"
import { Duration, Effect, Exit, Fiber, Option, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import * as OperationWait from "../src/internal/OperationWait.js"
import * as Operation from "../src/Operation.js"
import * as PolygresError from "../src/PolygresError.js"

const operationId = "00000000-0000-0000-0000-000000000002"

const operation = (
  status: string,
  stage: string,
  error: Option.Option<Operation.Failure> = Option.none(),
): Operation.Value => ({
  id: operationId,
  collectionId: Option.none(),
  kind: "collection_create",
  status,
  stage,
  processedUnits: 0,
  totalUnits: Option.none(),
  attempts: 0,
  retryUntil: "2026-01-01T00:00:00Z",
  error,
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: Option.none(),
  finishedAt: Option.none(),
  updatedAt: "2026-01-01T00:00:00Z",
  requestId: Option.some("req_wait"),
  metadata: {},
})

const runWithClock = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provide(TestClock.layer()), Effect.runPromise)

test("poll cadence is stage-aware and resets when the stage changes", async () => {
  const stages = ["index", "index", "index", "index", "index", "index", "verify", "ready"]
  const remaining: Array<number> = []

  const completed = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make((_id, budget) =>
        Effect.sync(() => {
          remaining.push(Duration.toMillis(budget))
          const stage = stages.shift() ?? "ready"
          return operation(stage === "ready" ? "succeeded" : "running", stage)
        }),
      )
      const fiber = yield* waiter(operationId, {
        initial: operation("running", "index"),
        timeout: "60 seconds",
      }).pipe(Effect.forkChild)

      yield* Effect.yieldNow
      for (const delay of [2, 2, 2, 2, 2, 2, 5, 2]) {
        yield* TestClock.adjust(Duration.seconds(delay))
        yield* Effect.yieldNow
      }
      return yield* Fiber.join(fiber)
    }),
  )

  expect(completed.status).toBe("succeeded")
  expect(remaining).toEqual([58_000, 56_000, 54_000, 52_000, 50_000, 48_000, 43_000, 41_000])
  expect(
    [0, 10, 10.1, 60, 60.1, 300, 301].map((seconds) =>
      Duration.toMillis(OperationWait.pollInterval(`${seconds} seconds`)),
    ),
  ).toEqual([2_000, 2_000, 5_000, 5_000, 15_000, 15_000, 30_000])
})

test("terminal initial operations never poll", async () => {
  let polls = 0
  const waiter = OperationWait.make(() => {
    polls++
    return Effect.succeed(operation("running", "unexpected"))
  })

  const succeeded = await waiter(operationId, {
    initial: operation("succeeded", "ready"),
    timeout: "1 second",
  }).pipe(Effect.runPromise)
  expect(succeeded.status).toBe("succeeded")

  const failureBody: Operation.Failure = {
    code: "CONTEXT_COLLECTION_NOT_FOUND",
    message: "The collection disappeared.",
    details: { collection: "support_docs" },
    httpStatus: 404,
    variant: Option.none(),
    metadata: {},
  }
  const failed = await waiter(operationId, {
    initial: operation("failed", "failed", Option.some(failureBody)),
    timeout: "1 second",
  }).pipe(Effect.flip, Effect.runPromise)
  expect(failed).toBeInstanceOf(PolygresError.NotFound)
  if (failed instanceof PolygresError.NotFound) {
    expect(failed.code).toBe("CONTEXT_COLLECTION_NOT_FOUND")
    expect(failed.details.operation_id).toBe(operationId)
  }

  const cancelled = await waiter(operationId, {
    initial: operation("cancelled", "cancelled"),
    timeout: "1 second",
  }).pipe(Effect.flip, Effect.runPromise)
  expect(cancelled).toBeInstanceOf(PolygresError.Api)
  if (cancelled instanceof PolygresError.Api) {
    expect(cancelled.code).toBe("CONTEXT_OPERATION_CANCELLED")
    expect(cancelled.details.operation_id).toBe(operationId)
  }
  expect(polls).toBe(0)
})

test("terminal failures use canonical errors, safe details, fallback codes, and redaction", async () => {
  const waiter = OperationWait.make(() => Effect.die("must not poll"))
  const secret = "poly_live_0123456789abcdef0123456789abcdef"
  const knownFailure: Operation.Failure = {
    code: "CONTEXT_COLLECTION_NOT_FOUND",
    message: `untrusted ${secret}`,
    details: { collection: secret, unsafe: secret },
    httpStatus: 500,
    variant: Option.none(),
    metadata: {},
  }
  const known = await waiter(operationId, {
    initial: operation("failed", "failed", Option.some(knownFailure)),
  }).pipe(Effect.flip, Effect.runPromise)

  expect(known).toBeInstanceOf(PolygresError.NotFound)
  if (known instanceof PolygresError.NotFound) {
    expect(known.status).toBe(404)
    expect(known.message).not.toContain(secret)
    expect(known.details).toEqual({
      collection: "[REDACTED]",
      operation_id: operationId,
      operation_status: "failed",
    })
  }

  const unknownFailure: Operation.Failure = {
    ...knownFailure,
    code: "FUTURE_FAILURE",
    details: { secret },
  }
  const unknown = await waiter(operationId, {
    initial: operation("failed", "failed", Option.some(unknownFailure)),
  }).pipe(Effect.flip, Effect.runPromise)
  expect(unknown).toBeInstanceOf(PolygresError.Server)
  if (unknown instanceof PolygresError.Server) {
    expect(unknown.code).toBe("CONTEXT_OPERATION_FAILED")
    expect(unknown.details).toEqual({ operation_id: operationId, operation_status: "failed" })
  }
})

test("cancel_requested and unknown future statuses remain nonterminal", async () => {
  const responses = [operation("future_paused", "queued"), operation("succeeded", "ready")]
  let polls = 0
  const result = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make(() =>
        Effect.sync(() => {
          polls++
          return responses.shift() ?? operation("succeeded", "ready")
        }),
      )
      const fiber = yield* waiter(operationId, {
        initial: operation("cancel_requested", "queued"),
        timeout: "10 seconds",
      }).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("2 seconds")
      yield* Effect.yieldNow
      yield* TestClock.adjust("2 seconds")
      return yield* Fiber.join(fiber)
    }),
  )

  expect(result.status).toBe("succeeded")
  expect(polls).toBe(2)
})

test("a poll result can override the adaptive delay", async () => {
  let polls = 0
  const result = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make(() =>
        Effect.sync(() => {
          polls++
          return polls === 1
            ? {
                _tag: "PollResult" as const,
                operation: operation("running", "building_index"),
                retryAfterMillis: 7_000,
              }
            : operation("succeeded", "ready")
        }),
      )
      const fiber = yield* waiter(operationId, {
        initial: operation("queued", "queued"),
        timeout: "15 seconds",
      }).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("2 seconds")
      yield* Effect.yieldNow
      yield* TestClock.adjust("6999 millis")
      expect(polls).toBe(1)
      yield* TestClock.adjust("1 millis")
      return yield* Fiber.join(fiber)
    }),
  )

  expect(result.status).toBe("succeeded")
  expect(polls).toBe(2)
})

test("one deadline bounds sleep and preserves the latest operation on timeout", async () => {
  let polls = 0
  const latest = operation("running", "queued")
  const error = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make(() => {
        polls++
        return Effect.succeed(operation("succeeded", "ready"))
      })
      const fiber = yield* waiter(operationId, { initial: latest, timeout: "1 second" }).pipe(
        Effect.flip,
        Effect.forkChild,
      )
      yield* Effect.yieldNow
      yield* TestClock.adjust("999 millis")
      expect(polls).toBe(0)
      yield* TestClock.adjust("1 millis")
      return yield* Fiber.join(fiber)
    }),
  )

  expect(error).toBeInstanceOf(Operation.TimedOut)
  if (error instanceof Operation.TimedOut) {
    expect(error.operationId).toBe(operationId)
    expect(Option.getOrUndefined(error.latest)).toEqual(latest)
  }
  expect(polls).toBe(0)
})

test("the remaining deadline bounds an in-flight poll", async () => {
  const budgets: Array<number> = []
  const error = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make((_id, remaining) => {
        budgets.push(Duration.toMillis(remaining))
        return Effect.never
      })
      const fiber = yield* waiter(operationId, { timeout: "1 second" }).pipe(Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      return yield* Fiber.join(fiber)
    }),
  )

  expect(budgets).toEqual([1_000])
  expect(error).toBeInstanceOf(Operation.TimedOut)
  if (error instanceof Operation.TimedOut) expect(Option.isNone(error.latest)).toBe(true)
})

test("a poll failure at the absolute deadline becomes a local timeout", async () => {
  const error = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make(() => Effect.sleep("1 second").pipe(Effect.andThen(Effect.fail("late"))))
      const fiber = yield* waiter(operationId, { timeout: "1 second" }).pipe(Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      return yield* Fiber.join(fiber)
    }),
  )
  expect(error).toBeInstanceOf(Operation.TimedOut)
})

test("an uninterruptible poll cannot extend the waiter deadline", async () => {
  const error = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make(() =>
        Effect.sleep("10 seconds").pipe(Effect.as(operation("running", "late")), Effect.uninterruptible),
      )
      const fiber = yield* waiter(operationId, { timeout: "1 second" }).pipe(Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      return yield* Fiber.join(fiber)
    }),
  )
  expect(error).toBeInstanceOf(Operation.TimedOut)
})

test("an in-flight refresh timeout retains the last observed state", async () => {
  const latest = operation("running", "queued")
  const error = await runWithClock(
    Effect.gen(function* () {
      const waiter = OperationWait.make(() => Effect.never)
      const fiber = yield* waiter(operationId, { initial: latest, timeout: "3 seconds" }).pipe(
        Effect.flip,
        Effect.forkChild,
      )
      yield* Effect.yieldNow
      yield* TestClock.adjust("2 seconds")
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")
      return yield* Fiber.join(fiber)
    }),
  )

  expect(error).toBeInstanceOf(Operation.TimedOut)
  if (error instanceof Operation.TimedOut) expect(Option.getOrUndefined(error.latest)).toEqual(latest)
})

test("interruption stops only local observation", async () => {
  let polls = 0
  const { exit, pollInterrupted } = await runWithClock(
    Effect.gen(function* () {
      const interrupted = yield* Ref.make(false)
      const waiter = OperationWait.make(() => {
        polls++
        return Effect.never.pipe(Effect.ensuring(Ref.set(interrupted, true)))
      })
      const fiber = yield* waiter(operationId, { timeout: "1 minute" }).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 minute")
      return { exit: fiber.pollUnsafe(), pollInterrupted: yield* Ref.get(interrupted) }
    }),
  )

  expect(exit).toBeDefined()
  expect(exit === undefined ? false : Exit.isFailure(exit)).toBe(true)
  expect(polls).toBe(1)
  expect(pollInterrupted).toBe(true)
})

test("operation schemas reject malformed contract fields", () => {
  const decode = Schema.decodeUnknownSync(Operation.Value)
  expect(() => decode({ ...operation("running", "queued"), id: "not-a-uuid" })).toThrow()
  expect(() => decode({ ...operation("running", "queued"), kind: "future_kind" })).toThrow()
  expect(() => decode({ ...operation("running", "queued"), updatedAt: "today" })).toThrow()
})

test("additive operation fields cannot collide with poll-result discrimination", async () => {
  const value = { ...operation("succeeded", "ready"), operation: { future: true } }
  const result = await OperationWait.make(() => Effect.succeed(value))(operationId).pipe(Effect.runPromise)
  expect(result.id).toBe(operationId)
})
