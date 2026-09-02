import { Schema } from "effect"

export const JsonObject = Schema.Record(Schema.String, Schema.Json)
const Numeric = Schema.Union([Schema.Number, Schema.NumberFromString])

export const ReadinessState = Schema.Struct({
  ready: Schema.Boolean,
  default_config: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

export const RetrievalReadiness = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  project_id: Schema.String,
  graph: ReadinessState,
  vector: ReadinessState,
  hybrid: ReadinessState,
  metadata: Schema.optionalKey(JsonObject),
})
export type RetrievalReadiness = Schema.Schema.Type<typeof RetrievalReadiness>

const ConnectionEndpoint = Schema.Struct({
  host: Schema.String,
  connection_string_without_password: Schema.String,
})

export const ConnectionInfo = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  project_id: Schema.String,
  project_mode: Schema.optionalKey(Schema.String),
  database: Schema.String,
  username: Schema.String,
  port: Schema.Number,
  direct: ConnectionEndpoint,
  pooled: ConnectionEndpoint,
  metadata: Schema.optionalKey(JsonObject),
})
export type ConnectionInfo = Schema.Schema.Type<typeof ConnectionInfo>

export const NodeRef = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Schema.Union([Schema.String, Schema.Number]),
})
export type NodeRef = Schema.Schema.Type<typeof NodeRef>

export const GraphNode = Schema.Struct({
  ...NodeRef.fields,
  properties: Schema.optionalKey(JsonObject),
})
export type GraphNode = Schema.Schema.Type<typeof GraphNode>

export const GraphResult = Schema.Struct({
  node: GraphNode,
  depth: Schema.Number,
  rank: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  graph_score: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  path: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Json))),
  edge_path: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Json))),
  readable_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  relationships: Schema.optionalKey(Schema.Array(Schema.Json)),
  properties: Schema.optionalKey(JsonObject),
})
export type GraphResult = Schema.Schema.Type<typeof GraphResult>

export const VectorResult = Schema.Struct({
  ...NodeRef.fields,
  properties: JsonObject,
  distance: Schema.NullOr(Numeric),
  similarity: Schema.optionalKey(Schema.NullOr(Numeric)),
  score: Schema.NullOr(Numeric),
})
export type VectorResult = Schema.Schema.Type<typeof VectorResult>

export const TextResult = Schema.Struct({
  ...NodeRef.fields,
  properties: JsonObject,
  score: Numeric,
  similarity: Schema.optionalKey(Schema.NullOr(Numeric)),
  key: Schema.optionalKey(Schema.NullOr(JsonObject)),
})
export type TextResult = Schema.Schema.Type<typeof TextResult>

export const HybridResult = Schema.Struct({
  node: Schema.optionalKey(GraphNode),
  schema: Schema.optionalKey(Schema.String),
  table: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  properties: Schema.optionalKey(JsonObject),
  score: Schema.optionalKey(Numeric),
  final_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  rrf_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  vector_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  graph_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  vector_rank: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  graph_rank: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  graph_depth: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  distance: Schema.optionalKey(Schema.NullOr(Numeric)),
  similarity: Schema.optionalKey(Schema.NullOr(Numeric)),
  relationships: Schema.optionalKey(Schema.Array(Schema.Json)),
})
export type HybridResult = Schema.Schema.Type<typeof HybridResult>

export const Page = <A>(item: Schema.Schema<A> & { readonly DecodingServices: never }) =>
  Schema.Struct({
    request_id: Schema.optionalKey(Schema.String),
    results: Schema.Array(item),
    next_cursor: Schema.NullOr(Schema.String),
    has_more: Schema.Boolean,
  })

export const GraphPathResponse = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  paths: Schema.Array(JsonObject),
})
export type GraphPathResponse = Schema.Schema.Type<typeof GraphPathResponse>

export const GraphConnectionResponse = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  connections: Schema.Array(JsonObject),
})
export type GraphConnectionResponse = Schema.Schema.Type<typeof GraphConnectionResponse>

export interface ResultPage<A> {
  readonly results: ReadonlyArray<A>
  readonly nextCursor: string | null
  readonly hasMore: boolean
  readonly requestId?: string
}

export interface GraphOptions {
  readonly maxDepth?: number
  readonly relationshipTypes?: ReadonlyArray<string>
  readonly direction?: "in" | "out" | "any" | "both"
  readonly filters?: Readonly<Record<string, unknown>>
  readonly targetTable?: Omit<NodeRef, "id">
  readonly limit?: number
  readonly cursor?: string
}

export interface VectorOptions {
  readonly config?: string
  readonly limit?: number
  readonly filters?: Readonly<Record<string, unknown>>
  readonly maxDistance?: number
  readonly minSimilarity?: number
  readonly includeValues?: boolean
  readonly cursor?: string
}

export interface TextOptions {
  readonly config: string
  readonly limit?: number
  readonly filters?: Readonly<Record<string, unknown>>
  readonly cursor?: string
}

export interface HybridOptions extends GraphOptions {
  readonly config?: string
  readonly vectorWeight?: number
  readonly graphWeight?: number
  readonly vectorLimit?: number
}
