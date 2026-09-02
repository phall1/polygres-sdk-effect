import { Option, Schema } from "effect"

import { JsonObject } from "../Entity.js"
import type * as Operation from "../Operation.js"
import * as PolygresError from "../PolygresError.js"
import type * as Rows from "../Rows.js"

const NullableString = Schema.NullOr(Schema.String)
const Uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i))

const RowValidationContext = Schema.Struct({
  requested: Schema.Boolean,
  collection_id: Uuid,
  source_key_column: Schema.String,
})

export const WriteValidation = Schema.Struct({
  valid: Schema.Literal(true),
  operation: Schema.Literals(["insert", "upsert", "ignore"]),
  schema: Schema.String,
  table: Schema.String,
  writable_columns: Schema.Array(Schema.String),
  conflict_constraint: NullableString,
  context: Schema.optionalKey(Schema.NullOr(RowValidationContext)),
  request_id: Schema.String,
})

const RowContextError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
  details: JsonObject,
})

const RowContextReconciliation = Schema.Struct({
  collection_id: Uuid,
  status: Schema.Literals(["completed", "pending", "partial_failed"]),
  operation_id: Schema.NullOr(Uuid),
  operation_status: NullableString,
  retry_until: NullableString,
  error: Schema.NullOr(RowContextError),
})

export const WriteResult = Schema.Struct({
  operation: Schema.Literals(["inserted", "upserted", "ignored"]),
  schema: Schema.String,
  table: Schema.String,
  returned: JsonObject,
  status: Schema.Literals(["completed", "pending", "partial_failed"]),
  row_committed: Schema.Literal(true),
  context: Schema.optionalKey(Schema.NullOr(RowContextReconciliation)),
  idempotency_key: Schema.optionalKey(NullableString),
  request_id: Schema.String,
})

const ContextOperationFailure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: JsonObject,
  http_status: Schema.Int,
  variant: Schema.optionalKey(NullableString),
})

export const ContextOperationEnvelope = Schema.Struct({
  operation: Schema.Struct({
    id: Uuid,
    collection_id: Schema.NullOr(Uuid),
    kind: Schema.Literals([
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
    ]),
    status: Schema.String,
    stage: Schema.String,
    processed_units: Schema.Int,
    total_units: Schema.NullOr(Schema.Int),
    attempts: Schema.Int,
    retry_until: Schema.String,
    error: Schema.NullOr(ContextOperationFailure),
    created_at: Schema.String,
    started_at: NullableString,
    finished_at: NullableString,
    updated_at: Schema.String,
  }),
  request_id: Schema.String,
})

export const writeValidation = (value: Schema.Schema.Type<typeof WriteValidation>): Rows.WriteValidation => ({
  valid: value.valid,
  operation: value.operation,
  schema: value.schema,
  table: value.table,
  writableColumns: value.writable_columns,
  conflictConstraint: Option.fromNullishOr(value.conflict_constraint),
  context: Option.fromNullishOr(value.context).pipe(
    Option.map((context) => ({
      requested: context.requested,
      collectionId: context.collection_id,
      sourceKeyColumn: context.source_key_column,
    })),
  ),
  requestId: PolygresError.redact(value.request_id),
})

const contextReconciliation = (
  value: Schema.Schema.Type<typeof RowContextReconciliation>,
): Rows.ContextReconciliation => ({
  collectionId: value.collection_id,
  status: value.status,
  operationId: Option.fromNullishOr(value.operation_id),
  operationStatus: Option.fromNullishOr(value.operation_status),
  retryUntil: Option.fromNullishOr(value.retry_until),
  error: Option.fromNullishOr(value.error).pipe(
    Option.map((error) => ({
      ...error,
      message: PolygresError.redact(error.message),
      details: PolygresError.sanitizeDetails(error.details),
    })),
  ),
})

export const writeResult = (value: Schema.Schema.Type<typeof WriteResult>): Rows.WriteResult => ({
  operation: value.operation,
  schema: value.schema,
  table: value.table,
  returned: value.returned,
  status: value.status,
  rowCommitted: value.row_committed,
  context: Option.fromNullishOr(value.context).pipe(Option.map(contextReconciliation)),
  idempotencyKey: Option.fromNullishOr(value.idempotency_key),
  requestId: PolygresError.redact(value.request_id),
})

export const contextOperation = (value: Schema.Schema.Type<typeof ContextOperationEnvelope>): Operation.Value => ({
  id: value.operation.id,
  collectionId: Option.fromNullishOr(value.operation.collection_id),
  kind: value.operation.kind,
  status: value.operation.status,
  stage: value.operation.stage,
  processedUnits: value.operation.processed_units,
  totalUnits: Option.fromNullishOr(value.operation.total_units),
  attempts: value.operation.attempts,
  retryUntil: value.operation.retry_until,
  error: Option.fromNullishOr(value.operation.error).pipe(
    Option.map((failure) => ({
      code: failure.code,
      message: failure.message,
      details: failure.details,
      httpStatus: failure.http_status,
      variant: Option.fromNullishOr(failure.variant),
      metadata: WireMetadata(failure, new Set(["code", "message", "details", "http_status", "variant"])),
    })),
  ),
  createdAt: value.operation.created_at,
  startedAt: Option.fromNullishOr(value.operation.started_at),
  finishedAt: Option.fromNullishOr(value.operation.finished_at),
  updatedAt: value.operation.updated_at,
  requestId: Option.some(PolygresError.redact(value.request_id)),
  metadata: WireMetadata(
    value.operation,
    new Set([
      "id",
      "collection_id",
      "kind",
      "status",
      "stage",
      "processed_units",
      "total_units",
      "attempts",
      "retry_until",
      "error",
      "created_at",
      "started_at",
      "finished_at",
      "updated_at",
    ]),
  ),
})

const WireMetadata = (value: Readonly<Record<string, unknown>>, excluded: ReadonlySet<string>) =>
  PolygresError.sanitizeDetails(Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key))))
