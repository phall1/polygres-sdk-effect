import { Clock, Duration, Effect, Fiber, Option, Result } from "effect"

import * as Operation from "../Operation.js"
import * as PolygresError from "../PolygresError.js"

const DEFAULT_TIMEOUT = Duration.minutes(30)

export interface PollResult {
  readonly _tag: "PollResult"
  readonly operation: Operation.Value
  readonly retryAfterMillis?: number
}

export type GetOperation<E, R> = (
  operationId: string,
  remaining: Duration.Duration,
) => Effect.Effect<Operation.Value | PollResult, E, R>

export interface Options {
  readonly initial?: Operation.Value
  readonly timeout?: Duration.Input
}

export type Waiter<E, R> = (
  operationId: string,
  options?: Options,
) => Effect.Effect<Operation.Value, E | Operation.WaitError, R>

export const pollInterval = (elapsedStage: Duration.Input): Duration.Duration => {
  const seconds = Duration.toMillis(elapsedStage) / 1_000
  if (seconds <= 10) return Duration.seconds(2)
  if (seconds <= 60) return Duration.seconds(5)
  if (seconds <= 300) return Duration.seconds(15)
  return Duration.seconds(30)
}

export const wait = <E, R>(
  getOperation: GetOperation<E, R>,
  operationId: string,
  options: Options = {},
): Effect.Effect<Operation.Value, E | Operation.WaitError, R> =>
  Effect.gen(function* () {
    const timeout = Duration.fromInput(options.timeout ?? DEFAULT_TIMEOUT)
    const timeoutNanos = Option.flatMap(timeout, Duration.toNanos).pipe(Option.getOrUndefined)
    if (timeoutNanos === undefined || timeoutNanos <= 0n) {
      return yield* new Operation.InvalidWaitTimeout({ message: "timeout must be positive and finite" })
    }

    const started = yield* Clock.monotonicTimeNanos
    const deadline = started + timeoutNanos
    let latest = Option.fromNullishOr(options.initial)
    let shouldPoll = Option.isNone(latest)
    let observedStage: string | undefined
    let stageStarted = started
    let retryAfterMillis: number | undefined

    while (true) {
      if (shouldPoll) {
        const now = yield* Clock.monotonicTimeNanos
        const remaining = deadline - now
        if (remaining <= 0n) return yield* timedOut(operationId, latest)

        const outcome = yield* hardTimeout(
          getOperation(operationId, Duration.nanos(remaining)),
          Duration.nanos(remaining),
        ).pipe(Effect.result)
        if (Result.isFailure(outcome)) {
          const failedAt = yield* Clock.monotonicTimeNanos
          return yield* failedAt >= deadline ? timedOut(operationId, latest) : Effect.fail(outcome.failure)
        }
        const result = outcome.success
        if (Option.isNone(result)) return yield* timedOut(operationId, latest)

        const polled = result.value
        if (isPollResult(polled)) {
          latest = Option.some(polled.operation)
          retryAfterMillis = polled.retryAfterMillis
        } else {
          latest = Option.some(polled)
          retryAfterMillis = undefined
        }
        shouldPoll = false
      }

      const operation = Option.getOrThrow(latest)
      if (operation.status === "succeeded") return operation
      if (operation.status === "failed") {
        return yield* failed(operationId, operation)
      }
      if (operation.status === "cancelled") {
        const requestId = Option.getOrUndefined(operation.requestId)
        return yield* PolygresError.fromApi({
          operation: "context.waitForOperation",
          status: 409,
          code: "CONTEXT_OPERATION_CANCELLED",
          ...(requestId === undefined ? {} : { requestId }),
          additionalSafeDetails: { operation_id: operationId, operation_status: "cancelled" },
        })
      }

      const now = yield* Clock.monotonicTimeNanos
      if (operation.stage !== observedStage) {
        observedStage = operation.stage
        stageStarted = now
      }

      const remaining = deadline - now
      if (remaining <= 0n) return yield* timedOut(operationId, latest)

      const elapsedStage = Duration.nanos(now - stageStarted)
      const retryNanos = retryAfterNanos(retryAfterMillis)
      const delay = retryNanos ?? Duration.toNanosUnsafe(pollInterval(elapsedStage))
      if (delay >= remaining) {
        yield* Effect.sleep(Duration.nanos(remaining))
        return yield* timedOut(operationId, latest)
      }

      yield* Effect.sleep(Duration.nanos(delay))
      shouldPoll = true
      retryAfterMillis = undefined
    }
  })

export const make =
  <E, R>(getOperation: GetOperation<E, R>): Waiter<E, R> =>
  (operationId, options) =>
    wait(getOperation, operationId, options)

const timedOut = (operationId: string, latest: Option.Option<Operation.Value>) =>
  new Operation.TimedOut({
    operation: "context.waitForOperation",
    operationId,
    code: "CONTEXT_OPERATION_TIMEOUT",
    requestId: latest.pipe(Option.flatMap((operation) => operation.requestId)),
    latest,
    message: `Timed out waiting for Context operation ${operationId}; it is still running.`,
    details: { operation_id: operationId },
  })

const retryAfterNanos = (retryAfterMillis: number | undefined): bigint | undefined =>
  retryAfterMillis === undefined || !Number.isFinite(retryAfterMillis)
    ? undefined
    : Duration.toNanosUnsafe(Duration.millis(Math.max(0, retryAfterMillis)))

const hardTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  duration: Duration.Duration,
): Effect.Effect<Option.Option<A>, E, R> =>
  Effect.gen(function* () {
    const fiber: Fiber.Fiber<A, E> = yield* Effect.forkDetach(effect)
    const interruptDetached = Fiber.interrupt(fiber).pipe(Effect.forkDetach, Effect.asVoid)
    const result = yield* Fiber.join(fiber).pipe(
      Effect.timeoutOption(duration),
      Effect.onInterrupt(() => interruptDetached),
    )
    if (Option.isNone(result)) yield* interruptDetached
    return result
  })

const failed = (operationId: string, operation: Operation.Value) => {
  const failure = Option.getOrUndefined(operation.error)
  const known = failure !== undefined && PolygresError.isCatalogCode(failure.code)
  const code = known ? failure.code : "CONTEXT_OPERATION_FAILED"
  const requestId = Option.getOrUndefined(operation.requestId)
  return PolygresError.fromApi({
    operation: "context.waitForOperation",
    status: failure?.httpStatus ?? 500,
    code,
    ...(known && Option.isSome(failure.variant) ? { variant: failure.variant.value } : {}),
    ...(requestId === undefined ? {} : { requestId }),
    details: known ? failure.details : {},
    additionalSafeDetails: { operation_id: operationId, operation_status: "failed" },
  })
}

const isPollResult = (value: Operation.Value | PollResult): value is PollResult =>
  "_tag" in value && value._tag === "PollResult"
