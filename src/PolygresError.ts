import { Schema, SchemaIssue } from "effect"

import { JsonObject } from "./Entity.js"
import { catalog } from "./internal/ErrorCatalog.js"

const apiFields = {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.Int,
  code: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
  retryAfterMillis: Schema.optionalKey(Schema.Finite),
  details: JsonObject,
}

export class Configuration extends Schema.TaggedError<Configuration>()("Polygres.Configuration", {
  reason: Schema.Literals(["api-key", "runtime-url", "project-id", "project-mode", "retries", "timeout", "deadline"]),
  message: Schema.String,
}) {}

export class InvalidInput extends Schema.TaggedError<InvalidInput>()("Polygres.InvalidInput", {
  operation: Schema.String,
  message: Schema.String,
  issues: Schema.Array(Schema.Struct({ path: Schema.Array(Schema.String), message: Schema.String })),
  code: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(JsonObject),
}) {}

export class Transport extends Schema.TaggedError<Transport>()("Polygres.Transport", {
  operation: Schema.String,
  reason: Schema.Literals(["request", "response"]),
  message: Schema.String,
  diagnostic: Schema.optionalKey(Schema.String),
  details: JsonObject,
}) {}

export class RequestTimeout extends Schema.TaggedError<RequestTimeout>()("Polygres.RequestTimeout", {
  operation: Schema.String,
  kind: Schema.Literals(["attempt", "deadline"]),
  message: Schema.String,
  details: JsonObject,
}) {}

export class InvalidResponse extends Schema.TaggedError<InvalidResponse>()("Polygres.InvalidResponse", {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.Int,
  requestId: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(
    Schema.Array(Schema.Struct({ path: Schema.Array(Schema.String), message: Schema.String })),
  ),
}) {}

export class Authentication extends Schema.TaggedError<Authentication>()("Polygres.Authentication", apiFields) {}
export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()("Polygres.PermissionDenied", apiFields) {}
export class NotFound extends Schema.TaggedError<NotFound>()("Polygres.NotFound", apiFields) {}
export class RateLimited extends Schema.TaggedError<RateLimited>()("Polygres.RateLimited", apiFields) {}
export class Maintenance extends Schema.TaggedError<Maintenance>()("Polygres.Maintenance", apiFields) {}
export class Server extends Schema.TaggedError<Server>()("Polygres.Server", apiFields) {}
export class Api extends Schema.TaggedError<Api>()("Polygres.Api", apiFields) {}
export class Validation extends Schema.TaggedError<Validation>()("Polygres.Validation", apiFields) {}
export class AmbiguousWrite extends Schema.TaggedError<AmbiguousWrite>()("Polygres.AmbiguousWrite", {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  code: Schema.String,
  requestId: Schema.optionalKey(Schema.String),
  retryAfterMillis: Schema.optionalKey(Schema.Finite),
  details: JsonObject,
}) {}

export type Request =
  | Transport
  | RequestTimeout
  | InvalidResponse
  | Authentication
  | PermissionDenied
  | NotFound
  | RateLimited
  | Maintenance
  | Server
  | Api
  | Validation

export type Search = Request | InvalidInput
export type Write = Request | InvalidInput | AmbiguousWrite

const secretPattern = /poly_live_[0-9a-f]{32}/gi

export const redact = (value: string): string => value.replace(secretPattern, "[REDACTED]")

export const isCatalogCode = (code: string): boolean => Object.hasOwn(catalog, code)

export const isRetryableContextError = (code: string): boolean => {
  const retryClass = catalog[code]?.[4]
  return retryClass === "after_delay" || retryClass === "bounded_retry" || retryClass === "user_retry"
}

export const addDetails = <E extends Request>(error: E, additions: Readonly<Record<string, unknown>>): E => {
  const current = "details" in error && typeof error.details === "object" ? error.details : {}
  const clone = Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error)) as E
  Object.defineProperty(clone, "details", {
    value: sanitizeRecord({ ...current, ...additions }),
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return clone
}

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: (issue) => issue._tag,
  checkHook: () => "Failed schema check",
})

export const schemaIssues = (issue: SchemaIssue.Issue) =>
  formatSchemaIssue(issue).issues.map((entry) => ({
    path: (entry.path ?? []).map((part) => redact(String(part))),
    message: entry.message,
  }))

const sanitize = (value: unknown): Schema.Schema.Type<typeof Schema.Json> => {
  if (typeof value === "string") return redact(value)
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
    return value
  if (Array.isArray(value)) return value.map(sanitize)
  if (typeof value === "object") return sanitizeRecord(value as Readonly<Record<string, unknown>>)
  return String(value)
}

const sanitizeRecord = (value: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitize(item)]))

export const sanitizeDetails = sanitizeRecord

export const fromApi = (input: {
  readonly operation: string
  readonly status: number
  readonly code?: string
  readonly variant?: string
  readonly message?: string
  readonly requestId?: string
  readonly retryAfterMillis?: number
  readonly details?: Readonly<Record<string, unknown>>
  readonly additionalSafeDetails?: Readonly<Record<string, unknown>>
}): Exclude<Request, Transport | RequestTimeout | InvalidResponse> => {
  const descriptor = input.code === undefined ? undefined : catalog[input.code]
  const selectedVariant = input.variant === undefined ? undefined : descriptor?.[3][input.variant]
  const status = selectedVariant?.[1] ?? descriptor?.[0] ?? input.status
  const safe = new Set(descriptor?.[2] ?? [])
  const details =
    descriptor === undefined
      ? (input.details ?? {})
      : Object.fromEntries(Object.entries(input.details ?? {}).filter(([key]) => safe.has(key)))
  const fields = {
    operation: input.operation,
    message: redact(selectedVariant?.[0] ?? descriptor?.[1] ?? input.message ?? `Polygres API error ${input.status}`),
    status,
    ...(input.code === undefined ? {} : { code: redact(input.code) }),
    ...(input.requestId === undefined ? {} : { requestId: redact(input.requestId) }),
    ...(input.retryAfterMillis === undefined ? {} : { retryAfterMillis: input.retryAfterMillis }),
    details: sanitizeRecord({ ...details, ...input.additionalSafeDetails }),
  }
  if (status === 401) return new Authentication(fields)
  if (status === 403) return new PermissionDenied(fields)
  if (status === 404) return new NotFound(fields)
  if (status === 429) return new RateLimited(fields)
  if (input.code === "MAINTENANCE_READ_ONLY" || input.code === "MAINTENANCE_FULL") return new Maintenance(fields)
  if ([408, 500, 502, 503, 504].includes(status)) return new Server(fields)
  if (
    (status === 400 && input.code === "UNSUPPORTED_API_VERSION") ||
    input.code === "VECTOR_CREATION_RETIRED" ||
    (status === 400 &&
      (input.code === "VECTOR_ROW_ID_INVALID" ||
        input.code === "VECTOR_ROW_ID_TYPE_UNSUPPORTED" ||
        input.code?.startsWith("CONTEXT_"))) ||
    ([400, 413, 422].includes(status) && input.code?.startsWith("ROW_"))
  ) {
    return new Validation(fields)
  }
  return new Api(fields)
}
