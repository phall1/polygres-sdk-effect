import { Schema } from "effect"

import { JsonObject, Node, Ref, TableRef } from "./Entity.js"

export const Direction = Schema.Literals(["in", "out", "any", "both"]).pipe(
  Schema.annotate({ identifier: "Polygres.Graph.Direction" }),
)
export type Direction = Schema.Schema.Type<typeof Direction>

const Depth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))
const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
const TraversalFields = {
  maxDepth: Schema.optionalKey(Depth),
  relationshipTypes: Schema.optionalKey(Schema.Array(Schema.String)),
  direction: Schema.optionalKey(Direction),
}
const SearchFields = {
  ...TraversalFields,
  filters: Schema.optionalKey(JsonObject),
  targetTable: Schema.optionalKey(TableRef),
  limit: Schema.optionalKey(Limit),
  cursor: Schema.optionalKey(Schema.String),
}

export const ExpandInput = Schema.Struct({
  start: Ref,
  ...SearchFields,
}).pipe(Schema.annotate({ identifier: "Polygres.Graph.ExpandInput" }))
export interface ExpandInput extends Schema.Schema.Type<typeof ExpandInput> {}

export const NeighborhoodInput = Schema.Struct({ start: Ref, ...SearchFields }).pipe(
  Schema.annotate({ identifier: "Polygres.Graph.NeighborhoodInput" }),
)
export interface NeighborhoodInput extends Schema.Schema.Type<typeof NeighborhoodInput> {}

export const RelatedInput = Schema.Struct({
  start: Ref,
  relationshipTypes: Schema.optionalKey(Schema.Array(Schema.String)),
  direction: Schema.optionalKey(Direction),
  filters: Schema.optionalKey(JsonObject),
  targetTable: Schema.optionalKey(TableRef),
  limit: Schema.optionalKey(Limit),
  cursor: Schema.optionalKey(Schema.String),
}).pipe(Schema.annotate({ identifier: "Polygres.Graph.RelatedInput" }))
export interface RelatedInput extends Schema.Schema.Type<typeof RelatedInput> {}

export const PathInput = Schema.Struct({ source: Ref, target: Ref, ...TraversalFields }).pipe(
  Schema.annotate({ identifier: "Polygres.Graph.PathInput" }),
)
export interface PathInput extends Schema.Schema.Type<typeof PathInput> {}

export const ConnectionInput = Schema.Struct({
  entities: Schema.Array(Ref).check(Schema.isMinLength(2), Schema.isMaxLength(10)),
  ...TraversalFields,
}).pipe(Schema.annotate({ identifier: "Polygres.Graph.ConnectionInput" }))
export interface ConnectionInput extends Schema.Schema.Type<typeof ConnectionInput> {}

export const Result = Schema.Struct({
  node: Node,
  depth: Schema.Int,
  rank: Schema.Option(Schema.Int),
  graphScore: Schema.Option(Schema.Finite),
  path: Schema.Option(Schema.Array(Schema.Json)),
  edgePath: Schema.Option(Schema.Array(Schema.Json)),
  readablePath: Schema.Option(Schema.String),
  relationships: Schema.Array(Schema.Json),
}).pipe(Schema.annotate({ identifier: "Polygres.Graph.Result" }))
export interface Result extends Schema.Schema.Type<typeof Result> {}

export const PathResponse = Schema.Struct({
  paths: Schema.Array(JsonObject),
  requestId: Schema.Option(Schema.String),
  metadata: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Graph.PathResponse" }))
export interface PathResponse extends Schema.Schema.Type<typeof PathResponse> {}

export const ConnectionResponse = Schema.Struct({
  connections: Schema.Array(JsonObject),
  requestId: Schema.Option(Schema.String),
  metadata: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Graph.ConnectionResponse" }))
export interface ConnectionResponse extends Schema.Schema.Type<typeof ConnectionResponse> {}
