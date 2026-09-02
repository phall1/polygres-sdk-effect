import { Clock, Duration, Effect, Option, Random, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

import * as PolygresError from "../PolygresError.js"

export interface Config {
  readonly apiKey: Redacted.Redacted
  readonly baseUrl: string
  readonly timeout: Duration.Duration
  readonly maxRetries: number
  readonly headers: Readonly<Record<string, string>>
  readonly apiVersion: string
  readonly clientVersion: string
}

export interface Request {
  readonly operation: string
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
  readonly path: string
  readonly query?: Readonly<Record<string, boolean | number | string | null | undefined>>
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
  readonly retry: "idempotentMutation" | "never" | "readOnly"
  readonly expectedStatuses?: ReadonlyArray<number>
  readonly timeout?: Duration.Duration
  readonly budget?: Duration.Duration
}

export interface Service {
  readonly request: (request: Request) => Effect.Effect<unknown, PolygresError.Request>
  readonly requestWithMetadata: (request: Request) => Effect.Effect<Response, PolygresError.Request>
}

export interface Response {
  readonly payload: unknown
  readonly status: number
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly retryAfterMillis?: number
}

const retryStatuses = new Set([408, 429, 500, 502, 503, 504])
const maintenanceCodes = new Set(["MAINTENANCE_FULL", "MAINTENANCE_READ_ONLY"])

const protectedHeaders = (config: Config, hasBody: boolean) => ({
  accept: "application/json",
  ...(hasBody ? { "content-type": "application/json" } : {}),
  authorization: `Bearer ${Redacted.value(config.apiKey)}`,
  "user-agent": `polygres-effect/${config.clientVersion}`,
  "x-polygres-client-info": `polygres-effect/${config.clientVersion}; runtime/effect-http`,
  "x-polygres-api-version": config.apiVersion,
})

const idempotencyHeader = (headers: Readonly<Record<string, string>> | undefined): string | undefined =>
  Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "idempotency-key")?.[1]

const withoutIdempotency = (headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "idempotency-key"))

const requestHeaders = (config: Config, request: Request) => {
  const key = idempotencyHeader(request.headers)
  return {
    ...withoutIdempotency(config.headers),
    ...withoutIdempotency(request.headers ?? {}),
    ...(key === undefined ? {} : { "idempotency-key": key }),
    ...protectedHeaders(config, request.body !== undefined),
  }
}

const requestUrl = (config: Config, request: Request): URL => {
  const url = new URL(`${config.baseUrl}${request.path}`)
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value))
  }
  return url
}

const makeRequest = (config: Config, request: Request): HttpClientRequest.HttpClientRequest => {
  return HttpClientRequest.make(request.method)(requestUrl(config, request))
}

const retryAfterMillis = (value: string | undefined): Effect.Effect<number | undefined> => {
  if (value === undefined) return Effect.succeed(undefined)
  const trimmed = value.trim()
  if (trimmed === "") return Effect.succeed(undefined)
  if (/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i.test(trimmed)) {
    const seconds = Number(trimmed)
    const milliseconds = seconds * 1_000
    return Effect.succeed(Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined)
  }
  const date = Date.parse(value)
  return Number.isFinite(date)
    ? Clock.currentTimeMillis.pipe(Effect.map((now) => Math.max(0, date - now)))
    : Effect.succeed(undefined)
}

const retryDelay = (attempt: number, retryAfter: number | undefined) =>
  retryAfter !== undefined
    ? Effect.succeed(Duration.millis(retryAfter))
    : Random.next.pipe(Effect.map((random) => Duration.millis(25 * 2 ** attempt + random * 5)))

const parseJson = (text: string): unknown => {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const errorDetails = (payload: unknown) => {
  if (payload === null || typeof payload !== "object") return {}
  const root = payload as Readonly<Record<string, unknown>>
  const error = root.error
  if (error === null || typeof error !== "object") {
    return { requestId: typeof root.request_id === "string" ? root.request_id : undefined }
  }
  const body = error as Readonly<Record<string, unknown>>
  return {
    requestId: typeof root.request_id === "string" ? root.request_id : undefined,
    code: typeof body.code === "string" ? body.code : undefined,
    variant: typeof body.variant === "string" ? body.variant : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    details:
      body.details !== null && typeof body.details === "object"
        ? (body.details as Readonly<Record<string, unknown>>)
        : undefined,
  }
}

const safeDiagnostic = (cause: unknown): string | undefined => {
  if (cause === null || typeof cause !== "object") return undefined
  const value = cause as { readonly _tag?: unknown; readonly name?: unknown; readonly code?: unknown }
  const label = typeof value._tag === "string" ? value._tag : typeof value.name === "string" ? value.name : undefined
  const code = typeof value.code === "string" && /^[A-Z0-9_]+$/.test(value.code) ? value.code : undefined
  const diagnostic = [label, code].filter((part) => part !== undefined).join(":")
  return diagnostic === "" ? undefined : PolygresError.redact(diagnostic)
}

export const make = (config: Config): Effect.Effect<Service, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    const requestWithMetadata = Effect.fn("Polygres.HttpTransport.request")(function* (input: Request) {
      const key = idempotencyHeader(input.headers)
      if (input.retry === "idempotentMutation" && (key === undefined || !/^[\x20-\x7e]{1,128}$/.test(key))) {
        return yield* new PolygresError.Transport({
          operation: input.operation,
          reason: "request",
          message: "Polygres refused an unsafe idempotent mutation before dispatch.",
          details: {},
          diagnostic: "MISSING_OR_INVALID_IDEMPOTENCY_KEY",
        })
      }
      const initial = makeRequest(config, input)
      const prepared = (
        input.body === undefined ? initial : HttpClientRequest.bodyJsonUnsafe(initial, input.body)
      ).pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeaders(requestHeaders(config, input)))
      const timeout = input.timeout === undefined ? config.timeout : Duration.min(config.timeout, input.timeout)
      const retryable = input.retry === "readOnly" || input.retry === "idempotentMutation"
      const budget = input.budget ?? Duration.sum(Duration.times(timeout, config.maxRetries + 1), Duration.seconds(1))
      const budgetNanos = Option.flatMap(Duration.fromInput(budget), Duration.toNanos).pipe(Option.getOrUndefined)
      if (budgetNanos === undefined || budgetNanos <= 0n) {
        return yield* new PolygresError.RequestTimeout({
          operation: input.operation,
          kind: "deadline",
          message: `Polygres exhausted the request budget for ${input.operation}.`,
          details: {},
        })
      }
      const started = yield* Clock.monotonicTimeNanos
      const deadline = started + budgetNanos

      const deadlineError = () =>
        new PolygresError.RequestTimeout({
          operation: input.operation,
          kind: "deadline",
          message: `Polygres exhausted the request budget for ${input.operation}.`,
          details: {},
        })

      const retryOrFail = (
        attempt: number,
        retryAfter: number | undefined,
        error: PolygresError.Request,
      ): Effect.Effect<Response, PolygresError.Request> => {
        if (!retryable || attempt >= config.maxRetries) return Effect.fail(error)
        return retryDelay(attempt, retryAfter).pipe(
          Effect.flatMap((delay) =>
            Clock.monotonicTimeNanos.pipe(
              Effect.flatMap((now) => {
                const remaining = deadline - now
                if (remaining <= 0n) return Effect.fail(deadlineError())
                const delayNanos = Duration.toNanosUnsafe(delay)
                if (delayNanos >= remaining) {
                  return Effect.sleep(Duration.nanos(remaining)).pipe(Effect.andThen(Effect.fail(deadlineError())))
                }
                return Effect.sleep(delay).pipe(Effect.andThen(send(attempt + 1)))
              }),
            ),
          ),
        )
      }

      const send = (attempt: number): Effect.Effect<Response, PolygresError.Request> => {
        const once = Clock.monotonicTimeNanos.pipe(
          Effect.flatMap((now) => {
            const remaining = deadline - now
            if (remaining <= 0n) return Effect.fail(deadlineError())
            return http.execute(prepared).pipe(
              Effect.mapError((cause) => {
                const diagnostic = safeDiagnostic(cause)
                return new PolygresError.Transport({
                  operation: input.operation,
                  reason: "request",
                  message: `Polygres could not reach the Runtime for ${input.operation}.`,
                  details: {},
                  ...(diagnostic === undefined ? {} : { diagnostic }),
                })
              }),
              Effect.flatMap((response) =>
                response.text.pipe(
                  Effect.mapError((cause) => {
                    const diagnostic = safeDiagnostic(cause)
                    return new PolygresError.Transport({
                      operation: input.operation,
                      reason: "response",
                      message: `Polygres could not read the Runtime response for ${input.operation}.`,
                      details: {},
                      ...(diagnostic === undefined ? {} : { diagnostic }),
                    })
                  }),
                  Effect.map((text) => ({ response, text, payload: parseJson(text) })),
                ),
              ),
              Effect.timeoutOrElse({
                duration: Duration.min(timeout, Duration.nanos(remaining)),
                orElse: () =>
                  Effect.fail(
                    new PolygresError.RequestTimeout({
                      operation: input.operation,
                      kind: "attempt",
                      message: `Polygres timed out during an attempt for ${input.operation}.`,
                      details: {},
                    }),
                  ),
              }),
            )
          }),
        )

        return once.pipe(
          Effect.matchEffect({
            onFailure: (error) => retryOrFail(attempt, undefined, error),
            onSuccess: ({ response, text, payload }) =>
              retryAfterMillis(response.headers["retry-after"]).pipe(
                Effect.flatMap((retryAfter) => {
                  const failure = errorDetails(payload)
                  if (
                    retryable &&
                    attempt < config.maxRetries &&
                    retryStatuses.has(response.status) &&
                    !maintenanceCodes.has(failure.code ?? "")
                  ) {
                    return retryOrFail(
                      attempt,
                      retryAfter,
                      PolygresError.fromApi({
                        operation: input.operation,
                        status: response.status,
                        ...(failure.code === undefined ? {} : { code: failure.code }),
                        ...(failure.variant === undefined ? {} : { variant: failure.variant }),
                        ...(failure.message === undefined ? {} : { message: failure.message }),
                        ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
                        ...(failure.details === undefined ? {} : { details: failure.details }),
                        ...(retryAfter === undefined ? {} : { retryAfterMillis: retryAfter }),
                      }),
                    )
                  }
                  const expected = input.expectedStatuses
                  if (
                    response.status < 200 ||
                    response.status >= 300 ||
                    (expected !== undefined && !expected.includes(response.status))
                  ) {
                    return Effect.fail(
                      PolygresError.fromApi({
                        operation: input.operation,
                        status: response.status,
                        ...(failure.code === undefined ? {} : { code: failure.code }),
                        ...(failure.variant === undefined ? {} : { variant: failure.variant }),
                        ...(failure.message === undefined ? {} : { message: failure.message }),
                        ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
                        ...(failure.details === undefined ? {} : { details: failure.details }),
                        ...(retryAfter === undefined ? {} : { retryAfterMillis: retryAfter }),
                      }),
                    )
                  }
                  return payload === undefined
                    ? Effect.fail(
                        new PolygresError.InvalidResponse({
                          operation: input.operation,
                          status: response.status,
                          message:
                            text.length === 0
                              ? "Polygres returned an empty response."
                              : "Polygres returned invalid JSON.",
                        }),
                      )
                    : Effect.succeed({
                        payload,
                        status: response.status,
                        headers: response.headers,
                        ...(retryAfter === undefined ? {} : { retryAfterMillis: retryAfter }),
                      })
                }),
              ),
          }),
        )
      }

      return yield* send(0)
    })

    const request = (input: Request) => requestWithMetadata(input).pipe(Effect.map((response) => response.payload))

    return { request, requestWithMetadata }
  })
