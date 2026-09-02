import { Schema } from "effect"

const apiFields = {
  message: Schema.String,
  status: Schema.Number,
  code: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
  details: Schema.Record(Schema.String, Schema.Json),
}

export class PolygresConfigError extends Schema.TaggedError<PolygresConfigError>()("PolygresConfigError", {
  reason: Schema.Literals(["api-key", "runtime-url", "retries", "timeout", "embedding", "limit", "input"]),
  message: Schema.String,
}) {}

export class PolygresAuthError extends Schema.TaggedError<PolygresAuthError>()("PolygresAuthError", apiFields) {}

export class PolygresPermissionError extends Schema.TaggedError<PolygresPermissionError>()(
  "PolygresPermissionError",
  apiFields,
) {}

export class PolygresNotFoundError extends Schema.TaggedError<PolygresNotFoundError>()(
  "PolygresNotFoundError",
  apiFields,
) {}

export class PolygresRateLimitError extends Schema.TaggedError<PolygresRateLimitError>()(
  "PolygresRateLimitError",
  apiFields,
) {}

export class PolygresMaintenanceError extends Schema.TaggedError<PolygresMaintenanceError>()(
  "PolygresMaintenanceError",
  apiFields,
) {}

export class PolygresApiError extends Schema.TaggedError<PolygresApiError>()("PolygresApiError", apiFields) {}

export class PolygresValidationError extends Schema.TaggedError<PolygresValidationError>()(
  "PolygresValidationError",
  apiFields,
) {}

export class PolygresRuntimeError extends Schema.TaggedError<PolygresRuntimeError>()(
  "PolygresRuntimeError",
  apiFields,
) {}

export class PolygresTransportError extends Schema.TaggedError<PolygresTransportError>()("PolygresTransportError", {
  reason: Schema.Literals(["network", "timeout"]),
  message: Schema.String,
}) {}

export class PolygresDecodeError extends Schema.TaggedError<PolygresDecodeError>()("PolygresDecodeError", {
  message: Schema.String,
  status: Schema.Number,
  requestId: Schema.optionalKey(Schema.String),
}) {}

export type PolygresError =
  | PolygresConfigError
  | PolygresAuthError
  | PolygresPermissionError
  | PolygresNotFoundError
  | PolygresRateLimitError
  | PolygresMaintenanceError
  | PolygresApiError
  | PolygresValidationError
  | PolygresRuntimeError
  | PolygresTransportError
  | PolygresDecodeError

export const apiError = (input: {
  readonly status: number
  readonly message: string
  readonly code?: string
  readonly requestId?: string
  readonly details?: Readonly<Record<string, unknown>>
}): Exclude<PolygresError, PolygresConfigError | PolygresTransportError | PolygresDecodeError> => {
  const canonical = canonicalError(input.status, input.code, input.message, input.details ?? {})
  const fields = {
    message: canonical.message,
    status: input.status,
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    details: canonical.details,
  }
  if ([400, 413, 422].includes(input.status) || input.code === "VECTOR_CREATION_RETIRED") {
    return new PolygresValidationError(fields)
  }
  if (input.status === 401) return new PolygresAuthError(fields)
  if (input.status === 403) return new PolygresPermissionError(fields)
  if (input.status === 404) return new PolygresNotFoundError(fields)
  if (input.status === 429) return new PolygresRateLimitError(fields)
  if (input.status === 503 && input.code?.includes("MAINTENANCE")) {
    return new PolygresMaintenanceError(fields)
  }
  if ([408, 500, 502, 503, 504].includes(input.status)) return new PolygresRuntimeError(fields)
  return new PolygresApiError(fields)
}

const secretPattern = /poly_live_[0-9a-f]{32}/gi

export const redact = (value: string): string => value.replace(secretPattern, "[REDACTED]")

const sanitize = (value: unknown): Schema.Schema.Type<typeof Schema.Json> => {
  if (typeof value === "string") return redact(value)
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (Array.isArray(value)) return value.map(sanitize)
  if (typeof value === "object") return sanitizeRecord(value as Readonly<Record<string, unknown>>)
  return String(value)
}

const sanitizeRecord = (
  value: Readonly<Record<string, unknown>>,
): Record<string, Schema.Schema.Type<typeof Schema.Json>> =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(api[_-]?key|authorization|password|secret|token)/i.test(key))
      .map(([key, item]) => [key, sanitize(item)]),
  )

const catalog: Readonly<
  Record<
    string,
    {
      readonly message: string
      readonly safe: ReadonlyArray<string>
    }
  >
> = {
  API_KEY_INVALID: { message: "The API key is invalid.", safe: [] },
  APPROVAL_REQUIRED: { message: "Account approval is required.", safe: [] },
  MAINTENANCE_FULL: { message: "Polygres is temporarily unavailable for maintenance.", safe: [] },
  MAINTENANCE_READ_ONLY: { message: "Polygres is temporarily read-only for maintenance.", safe: [] },
  UNSUPPORTED_API_VERSION: {
    message: "The requested Runtime API version is not supported.",
    safe: ["supported_versions"],
  },
  SYNCED_PROJECT_SURFACE_UNAVAILABLE: {
    message: "Connection information is unavailable for synchronized projects.",
    safe: [],
  },
  VECTOR_ROW_ID_INVALID: {
    message: "The row ID is invalid for the configured vector index.",
    safe: ["row_id_column", "expected_type"],
  },
}

const fallbackMessage = (status: number): string => {
  if (status === 400 || status === 413 || status === 422) return "The Polygres request is invalid."
  if (status === 401) return "Polygres authentication failed."
  if (status === 403) return "The Polygres request is not permitted."
  if (status === 404) return "The requested Polygres resource was not found."
  if (status === 429) return "Polygres rate limited the request."
  if (status >= 500) return "Polygres is temporarily unavailable."
  return "The Polygres request failed."
}

const canonicalError = (
  status: number,
  code: string | undefined,
  _untrustedMessage: string,
  details: Readonly<Record<string, unknown>>,
) => {
  const descriptor = code === undefined ? undefined : catalog[code]
  const safe = new Set(descriptor?.safe ?? [])
  return {
    message: descriptor?.message ?? fallbackMessage(status),
    details: sanitizeRecord(Object.fromEntries(Object.entries(details).filter(([key]) => safe.has(key)))),
  }
}
