import { Schema } from "effect"

import { JsonObject } from "./Entity.js"
import type * as PolygresError from "./PolygresError.js"

const Uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i))
const DateTimeString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/),
  Schema.makeFilter((value) => (Number.isNaN(Date.parse(value)) ? "must be an RFC 3339 date-time" : undefined)),
)

export const Kind = Schema.Literals([
  "collection_create",
  "collection_set_default",
  "collection_update",
  "collection_delete",
  "collection_reindex",
  "vector_add",
  "filter_add_column",
  "filter_add_jsonb_path",
  "points_upsert",
  "points_delete",
  "points_reconcile",
]).pipe(Schema.annotate({ identifier: "Polygres.Operation.Kind" }))
export type Kind = Schema.Schema.Type<typeof Kind>

export const KnownStatus = Schema.Literals([
  "queued",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "cancelled",
]).pipe(Schema.annotate({ identifier: "Polygres.Operation.KnownStatus" }))
export type KnownStatus = Schema.Schema.Type<typeof KnownStatus>

// The Runtime contract explicitly permits additive future status strings.
export const Status = Schema.String.pipe(Schema.annotate({ identifier: "Polygres.Operation.Status" }))
export type Status = Schema.Schema.Type<typeof Status>

export const Failure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: JsonObject,
  httpStatus: Schema.Int,
  variant: Schema.Option(Schema.String),
  metadata: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Operation.Failure" }))
export interface Failure extends Schema.Schema.Type<typeof Failure> {}

export const Value = Schema.Struct({
  id: Uuid,
  collectionId: Schema.Option(Uuid),
  kind: Kind,
  status: Status,
  stage: Schema.String,
  processedUnits: Schema.Int,
  totalUnits: Schema.Option(Schema.Int),
  attempts: Schema.Int,
  retryUntil: DateTimeString,
  error: Schema.Option(Failure),
  createdAt: DateTimeString,
  startedAt: Schema.Option(DateTimeString),
  finishedAt: Schema.Option(DateTimeString),
  updatedAt: DateTimeString,
  requestId: Schema.Option(Schema.String),
  metadata: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Operation.Value" }))
export interface Value extends Schema.Schema.Type<typeof Value> {}

export class InvalidWaitTimeout extends Schema.TaggedError<InvalidWaitTimeout>()(
  "Polygres.Operation.InvalidWaitTimeout",
  { message: Schema.String },
) {}

export class TimedOut extends Schema.TaggedError<TimedOut>()("Polygres.Operation.TimedOut", {
  operation: Schema.Literal("context.waitForOperation"),
  operationId: Uuid,
  code: Schema.Literal("CONTEXT_OPERATION_TIMEOUT"),
  requestId: Schema.Option(Schema.String),
  latest: Schema.Option(Value),
  message: Schema.String,
  details: JsonObject,
}) {}

export type WaitError = InvalidWaitTimeout | TimedOut | PolygresError.Request

export const isTerminal = (status: Status): boolean =>
  status === "succeeded" || status === "failed" || status === "cancelled"
