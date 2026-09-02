import { Schema } from "effect"

import { JsonObject, Ref } from "./Entity.js"
import { Direction } from "./Graph.js"

const Embedding = Schema.Array(Schema.Finite).check(Schema.isMinLength(1))
const Depth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))
const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
const Fields = {
  embedding: Embedding,
  config: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  maxDepth: Schema.optionalKey(Depth),
  relationshipTypes: Schema.optionalKey(Schema.Array(Schema.String)),
  direction: Schema.optionalKey(Direction),
  filters: Schema.optionalKey(JsonObject),
  vectorWeight: Schema.optionalKey(Schema.Finite),
  graphWeight: Schema.optionalKey(Schema.Finite),
  vectorLimit: Schema.optionalKey(Limit),
  limit: Schema.optionalKey(Limit),
  cursor: Schema.optionalKey(Schema.String),
}

export const GraphFirstInput = Schema.Struct({ start: Ref, ...Fields }).pipe(
  Schema.annotate({ identifier: "Polygres.Hybrid.GraphFirstInput" }),
)
export interface GraphFirstInput extends Schema.Schema.Type<typeof GraphFirstInput> {}

export const VectorFirstInput = Schema.Struct({ start: Schema.optionalKey(Ref), ...Fields }).pipe(
  Schema.annotate({ identifier: "Polygres.Hybrid.VectorFirstInput" }),
)
export interface VectorFirstInput extends Schema.Schema.Type<typeof VectorFirstInput> {}

export const JointInput = Schema.Struct({ start: Ref, ...Fields }).pipe(
  Schema.annotate({ identifier: "Polygres.Hybrid.JointInput" }),
)
export interface JointInput extends Schema.Schema.Type<typeof JointInput> {}

export const Result = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Schema.String,
  properties: JsonObject,
  score: Schema.Finite,
  finalScore: Schema.Option(Schema.Finite),
  rrfScore: Schema.Option(Schema.Finite),
  vectorScore: Schema.Option(Schema.Finite),
  graphScore: Schema.Option(Schema.Finite),
  vectorRank: Schema.Option(Schema.Int),
  graphRank: Schema.Option(Schema.Int),
  graphDepth: Schema.Option(Schema.Int),
  distance: Schema.Option(Schema.Finite),
  similarity: Schema.Option(Schema.Finite),
  relationships: Schema.Array(Schema.Json),
}).pipe(Schema.annotate({ identifier: "Polygres.Hybrid.Result" }))
export interface Result extends Schema.Schema.Type<typeof Result> {}
