import { Schema } from "effect"

export const JsonObject = Schema.Record(Schema.String, Schema.Json).pipe(
  Schema.annotate({ identifier: "Polygres.Entity.JsonObject" }),
)
export interface JsonObject extends Schema.Schema.Type<typeof JsonObject> {}

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

export const Ref = Schema.Struct({
  schema: NonEmptyString,
  table: NonEmptyString,
  id: NonEmptyString,
}).pipe(Schema.annotate({ identifier: "Polygres.Entity.Ref" }))
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

export const TableRef = Schema.Struct({
  schema: NonEmptyString,
  table: NonEmptyString,
}).pipe(Schema.annotate({ identifier: "Polygres.Entity.TableRef" }))
export interface TableRef extends Schema.Schema.Type<typeof TableRef> {}

export const Node = Schema.Struct({
  schema: NonEmptyString,
  table: NonEmptyString,
  id: Schema.String,
  properties: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Entity.Node" }))
export interface Node extends Schema.Schema.Type<typeof Node> {}
