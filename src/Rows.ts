import { Schema } from "effect"

import { JsonObject } from "./Entity.js"

export const Mode = Schema.Literals(["insert", "upsert", "ignore"]).pipe(
  Schema.annotate({ identifier: "Polygres.Rows.Mode" }),
)
export type Mode = Schema.Schema.Type<typeof Mode>

const Identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/), Schema.isMaxLength(63))
const Uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i))
const Row = Schema.Record(Identifier, Schema.Json).check(Schema.isMinProperties(1), Schema.isMaxProperties(128))
const ColumnList = Schema.Array(Identifier).check(Schema.isUnique())
const NonEmptyColumnList = ColumnList.check(Schema.isMinLength(1))
const IdempotencyKey = Schema.String.check(Schema.isPattern(/^[\x20-\x7e]{1,128}$/))
const ContextFields = {
  reconcileContext: Schema.optionalKey(Schema.Boolean),
  contextCollectionId: Schema.optionalKey(Uuid),
}
const WriteFields = {
  schema: Identifier,
  table: Identifier,
  row: Row,
  returning: Schema.optionalKey(ColumnList),
  ...ContextFields,
  idempotencyKey: Schema.optionalKey(IdempotencyKey),
  waitForContext: Schema.optionalKey(Schema.Boolean),
  waitTimeout: Schema.optionalKey(Schema.Number),
}

export const ValidateInput = Schema.Struct({
  schema: Identifier,
  table: Identifier,
  row: Row,
  mode: Schema.optionalKey(Mode),
  conflictColumns: Schema.optionalKey(ColumnList),
  updateColumns: Schema.optionalKey(NonEmptyColumnList),
  returning: Schema.optionalKey(ColumnList),
  ...ContextFields,
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.ValidateInput" }))
export interface ValidateInput extends Schema.Schema.Type<typeof ValidateInput> {}

export const InsertInput = Schema.Struct(WriteFields).pipe(Schema.annotate({ identifier: "Polygres.Rows.InsertInput" }))
export interface InsertInput extends Schema.Schema.Type<typeof InsertInput> {}

export const UpsertInput = Schema.Struct({
  ...WriteFields,
  conflictColumns: NonEmptyColumnList,
  updateColumns: Schema.optionalKey(NonEmptyColumnList),
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.UpsertInput" }))
export interface UpsertInput extends Schema.Schema.Type<typeof UpsertInput> {}

export const IgnoreInput = Schema.Struct({
  ...WriteFields,
  conflictColumns: NonEmptyColumnList,
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.IgnoreInput" }))
export interface IgnoreInput extends Schema.Schema.Type<typeof IgnoreInput> {}

export const ValidationContext = Schema.Struct({
  requested: Schema.Boolean,
  collectionId: Uuid,
  sourceKeyColumn: Identifier,
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.ValidationContext" }))
export interface ValidationContext extends Schema.Schema.Type<typeof ValidationContext> {}

export const WriteValidation = Schema.Struct({
  valid: Schema.Literal(true),
  operation: Mode,
  schema: Identifier,
  table: Identifier,
  writableColumns: Schema.Array(Identifier),
  conflictConstraint: Schema.Option(Schema.String),
  context: Schema.Option(ValidationContext),
  requestId: Schema.String,
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.WriteValidation" }))
export interface WriteValidation extends Schema.Schema.Type<typeof WriteValidation> {}

export const ContextError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
  details: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.ContextError" }))
export interface ContextError extends Schema.Schema.Type<typeof ContextError> {}

export const ContextReconciliation = Schema.Struct({
  collectionId: Uuid,
  status: Schema.Literals(["completed", "pending", "partial_failed"]),
  operationId: Schema.Option(Uuid),
  operationStatus: Schema.Option(Schema.String),
  retryUntil: Schema.Option(Schema.String),
  error: Schema.Option(ContextError),
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.ContextReconciliation" }))
export interface ContextReconciliation extends Schema.Schema.Type<typeof ContextReconciliation> {}

export const WriteResult = Schema.Struct({
  operation: Schema.Literals(["inserted", "upserted", "ignored"]),
  schema: Identifier,
  table: Identifier,
  returned: JsonObject,
  status: Schema.Literals(["completed", "pending", "partial_failed"]),
  rowCommitted: Schema.Literal(true),
  context: Schema.Option(ContextReconciliation),
  idempotencyKey: Schema.Option(IdempotencyKey),
  requestId: Schema.String,
}).pipe(Schema.annotate({ identifier: "Polygres.Rows.WriteResult" }))
export interface WriteResult extends Schema.Schema.Type<typeof WriteResult> {}
