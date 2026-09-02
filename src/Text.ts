import { Schema } from "effect"

import { JsonObject } from "./Entity.js"

const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))

export const SearchInput = Schema.Struct({
  query: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(2000)),
  config: Schema.String.check(Schema.isPattern(/\S/)),
  limit: Schema.optionalKey(Limit),
  filters: Schema.optionalKey(JsonObject),
  cursor: Schema.optionalKey(Schema.String),
}).pipe(Schema.annotate({ identifier: "Polygres.Text.SearchInput" }))
export interface SearchInput extends Schema.Schema.Type<typeof SearchInput> {}

export const Result = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Schema.String,
  properties: JsonObject,
  score: Schema.Finite,
  similarity: Schema.Option(Schema.Finite),
  key: Schema.Option(JsonObject),
}).pipe(Schema.annotate({ identifier: "Polygres.Text.Result" }))
export interface Result extends Schema.Schema.Type<typeof Result> {}
