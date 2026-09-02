import { Clock, Duration, Effect, Random, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

import * as PolygresError from "../PolygresError.js"

export interface Config {
  readonly apiKey: Redacted.Redacted<string>
  readonly baseUrl: string
  readonly timeout: Duration.Duration
  readonly maxRetries: number
  readonly headers: Readonly<Record<string, string>>
  readonly apiVersion: string
  readonly clientVersion: string
}

export interface Request {
  readonly operation: string
  readonly method: "GET" | "POST"
  readonly path: string
  readonly body?: Readonly<Record<string, unknown>>
  readonly retry?: "read" | "never"
}

export interface Service {
  readonly request: (request: Request) => Effect.Effect<unknown, PolygresError.Request>
}

const retryStatuses = new Set([408, 429, 500, 502, 503, 504])
const maintenanceCodes = new Set(["MAINTENANCE_FULL", "MAINTENANCE_READ_ONLY"])

const omitAbsent = (value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null))

const headers = (config: Config) => ({
  ...config.headers,
  authorization: `Bearer ${Redacted.value(config.apiKey)}`,
  "user-agent": `polygres-effect/${config.clientVersion}`,
  "x-polygres-client-info": `polygres-effect/${config.clientVersion}; runtime/effect-http`,
  "x-polygres-api-version": config.apiVersion,
})

const retryAfterMillis = (value: string | undefined): Effect.Effect<number | undefined> => {
  if (value === undefined) return Effect.succeed(undefined)
  const trimmed = value.trim()
  if (trimmed === "") return Effect.succeed(undefined)
  if (/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i.test(trimmed)) {
    const seconds = Number(trimmed)
    return Effect.succeed(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined)
  }
  const date = Date.parse(value)
  return Number.isFinite(date)
    ? Clock.currentTimeMillis.pipe(Effect.map((now) => Math.max(0, date - now)))
    : Effect.succeed(undefined)
}

const backoff = (attempt: number, retryAfter: number | undefined) =>
  retryAfter !== undefined
    ? Effect.sleep(Duration.millis(retryAfter))
    : Random.next.pipe(Effect.flatMap((random) => Effect.sleep(Duration.millis(25 * 2 ** attempt + random * 5))))

const parseJson = (text: string): unknown | undefined => {
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

    const request = Effect.fn("Polygres.HttpTransport.request")(function* (input: Request) {
      const initial =
        input.method === "GET"
          ? HttpClientRequest.get(`${config.baseUrl}${input.path}`)
          : HttpClientRequest.post(`${config.baseUrl}${input.path}`)
      const prepared = (
        input.body === undefined ? initial : HttpClientRequest.bodyJsonUnsafe(initial, omitAbsent(input.body))
      ).pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeaders(headers(config)))

      const send = (attempt: number): Effect.Effect<unknown, PolygresError.Request> => {
        const once = http.execute(prepared).pipe(
          Effect.mapError((cause) => {
            const diagnostic = safeDiagnostic(cause)
            return new PolygresError.Transport({
              operation: input.operation,
              reason: "request",
              message: `Polygres could not reach the Runtime for ${input.operation}.`,
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
                  ...(diagnostic === undefined ? {} : { diagnostic }),
                })
              }),
              Effect.map((text) => ({ response, text, payload: parseJson(text) })),
            ),
          ),
          Effect.timeoutOrElse({
            duration: config.timeout,
            orElse: () =>
              Effect.fail(
                new PolygresError.RequestTimeout({
                  operation: input.operation,
                  kind: "attempt",
                  message: `Polygres timed out during an attempt for ${input.operation}.`,
                }),
              ),
          }),
        )

        return once.pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              input.retry === "read" && attempt < config.maxRetries
                ? backoff(attempt, undefined).pipe(Effect.andThen(send(attempt + 1)))
                : Effect.fail(error),
            onSuccess: ({ response, text, payload }) =>
              retryAfterMillis(response.headers["retry-after"]).pipe(
                Effect.flatMap((retryAfter) => {
                  const failure = errorDetails(payload)
                  if (
                    input.retry === "read" &&
                    attempt < config.maxRetries &&
                    retryStatuses.has(response.status) &&
                    !maintenanceCodes.has(failure.code ?? "")
                  ) {
                    return backoff(attempt, retryAfter).pipe(Effect.andThen(send(attempt + 1)))
                  }
                  if (response.status < 200 || response.status >= 300) {
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
                    : Effect.succeed(payload)
                }),
              ),
          }),
        )
      }

      return yield* send(0)
    })

    return { request }
  })
