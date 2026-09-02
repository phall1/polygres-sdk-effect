import { Schema } from "effect"

import { JsonObject } from "./Entity.js"

const Embedding = Schema.Array(Schema.Finite).check(Schema.isMinLength(1))
const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
const SearchFields = {
  config: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  limit: Schema.optionalKey(Limit),
  filters: Schema.optionalKey(JsonObject),
  maxDistance: Schema.optionalKey(Schema.Finite),
  minSimilarity: Schema.optionalKey(Schema.Finite),
  includeValues: Schema.optionalKey(Schema.Boolean),
  cursor: Schema.optionalKey(Schema.String),
}

export const SearchInput = Schema.Struct({ embedding: Embedding, ...SearchFields }).pipe(
  Schema.annotate({ identifier: "Polygres.Vector.SearchInput" }),
)
export interface SearchInput extends Schema.Schema.Type<typeof SearchInput> {}

export const SimilarToInput = Schema.Struct({
  rowId: Schema.String.check(Schema.isMinLength(1)),
  ...SearchFields,
}).pipe(Schema.annotate({ identifier: "Polygres.Vector.SimilarToInput" }))
export interface SimilarToInput extends Schema.Schema.Type<typeof SimilarToInput> {}

export const Result = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Schema.String,
  properties: JsonObject,
  distance: Schema.Option(Schema.Finite),
  similarity: Schema.Option(Schema.Finite),
  score: Schema.Option(Schema.Finite),
}).pipe(Schema.annotate({ identifier: "Polygres.Vector.Result" }))
export interface Result extends Schema.Schema.Type<typeof Result> {}
