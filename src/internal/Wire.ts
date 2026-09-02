import { Effect, Option, Schema, SchemaGetter } from "effect"
import { JsonObject } from "../Entity.js"
import type * as Graph from "../Graph.js"
import type * as Hybrid from "../Hybrid.js"
import * as Page from "../Page.js"
import * as PolygresError from "../PolygresError.js"
import type * as Runtime from "../Runtime.js"
import type * as Text from "../Text.js"
import type * as Vector from "../Vector.js"

type Decodable<A> = Schema.Schema<A> & { readonly DecodingServices: never }
type DomainSchema<A> = Decodable<A>

const PythonFiniteFromString = Schema.String.check(
  Schema.isPattern(/^\s*[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:e[+-]?\d(?:_?\d)*)?\s*$/i),
).pipe(
  Schema.decodeTo(Schema.Finite, {
    decode: SchemaGetter.transform((value) => Number(value.replaceAll("_", ""))),
    encode: SchemaGetter.transform(String),
  }),
)
const PythonIntegerFromString = Schema.String.check(Schema.isPattern(/^\s*[+-]?\d(?:_?\d)*\s*$/)).pipe(
  Schema.decodeTo(Schema.Int, {
    decode: SchemaGetter.transform((value) => Number(value.replaceAll("_", ""))),
    encode: SchemaGetter.transform(String),
  }),
)
const Numeric = Schema.Union([Schema.Finite, PythonFiniteFromString])
const Integer = Schema.Union([Schema.Int, PythonIntegerFromString])
const Id = Schema.Union([Schema.String, Schema.Finite])

const Node = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Id,
  properties: Schema.optionalKey(JsonObject),
})

export const Readiness = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  project_id: Schema.String,
  graph: Schema.Struct({ ready: Schema.Boolean, default_config: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
  vector: Schema.Struct({ ready: Schema.Boolean, default_config: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
  hybrid: Schema.Struct({ ready: Schema.Boolean, default_config: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
  metadata: Schema.optionalKey(JsonObject),
})

const ConnectionEndpoint = Schema.Struct({
  host: Schema.String,
  connection_string_without_password: Schema.String,
})

export const ConnectionInfo = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  project_id: Schema.String,
  project_mode: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Schema.Struct({ project_mode: Schema.optionalKey(Schema.String) })),
  database: Schema.String,
  username: Schema.String,
  port: Integer,
  direct: ConnectionEndpoint,
  pooled: ConnectionEndpoint,
  metadata: Schema.optionalKey(JsonObject),
})

export const GraphResult = Schema.Struct({
  node: Node,
  depth: Schema.optionalKey(Integer),
  rank: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  graph_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  path: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Json))),
  edge_path: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Json))),
  readable_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  relationships: Schema.optionalKey(Schema.Array(Schema.Json)),
  properties: Schema.optionalKey(JsonObject),
})

export const VectorResult = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Id,
  properties: Schema.optionalKey(JsonObject),
  distance: Schema.NullOr(Numeric),
  similarity: Schema.optionalKey(Schema.NullOr(Numeric)),
  score: Schema.NullOr(Numeric),
})

export const TextResult = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  id: Id,
  properties: Schema.optionalKey(JsonObject),
  score: Numeric,
  similarity: Schema.optionalKey(Schema.NullOr(Numeric)),
  key: Schema.optionalKey(Schema.NullOr(JsonObject)),
})

const HybridScores = {
  score: Schema.optionalKey(Numeric),
  final_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  rrf_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  vector_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  graph_score: Schema.optionalKey(Schema.NullOr(Numeric)),
  vector_rank: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  graph_rank: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  graph_depth: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  distance: Schema.optionalKey(Schema.NullOr(Numeric)),
  similarity: Schema.optionalKey(Schema.NullOr(Numeric)),
  relationships: Schema.optionalKey(Schema.Array(Schema.Json)),
  properties: Schema.optionalKey(JsonObject),
}

export const HybridResult = Schema.Union([
  Schema.Struct({ node: Node, ...HybridScores }),
  Schema.Struct({ schema: Schema.String, table: Schema.String, id: Id, ...HybridScores }),
])

export const GraphPathResponse = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  paths: Schema.Array(JsonObject),
})

export const GraphConnectionResponse = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  connections: Schema.Array(JsonObject),
})

const PageEnvelope = <A>(item: Decodable<A>) =>
  Schema.Struct({
    request_id: Schema.optionalKey(Schema.String),
    results: Schema.Array(item),
    next_cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
    has_more: Schema.optionalKey(Schema.Boolean),
    metadata: Schema.optionalKey(JsonObject),
  })

export const decode = <A>(operation: string, schema: Decodable<A>, payload: unknown) =>
  Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError((cause) => {
      const id = requestId(payload)
      return new PolygresError.InvalidResponse({
        operation,
        status: 200,
        message: "Polygres returned a response that does not satisfy its declared schema.",
        ...(id === undefined ? {} : { requestId: id }),
        issues: PolygresError.schemaIssues(cause.issue),
      })
    }),
  )

export const validate = <A>(operation: string, schema: DomainSchema<A>, value: A, payload: unknown = value) =>
  Schema.decodeUnknownEffect(Schema.toType(schema))(value).pipe(
    Effect.mapError((cause) => {
      const id = requestId(payload)
      return new PolygresError.InvalidResponse({
        operation,
        status: 200,
        message: "Polygres returned a response that does not satisfy its declared domain schema.",
        ...(id === undefined ? {} : { requestId: id }),
        issues: PolygresError.schemaIssues(cause.issue),
      })
    }),
  )

export const decodePage = <A, B>(
  operation: string,
  item: Decodable<A>,
  domain: DomainSchema<B>,
  map: (value: A) => B,
  payload: unknown,
): Effect.Effect<Page.Value<B>, PolygresError.InvalidResponse> =>
  decode(operation, PageEnvelope(item), payload).pipe(
    Effect.flatMap((page) =>
      validate(
        operation,
        Page.Value(domain),
        {
          items: page.results.map(map),
          nextCursor: Option.fromNullishOr(page.next_cursor),
          hasMore: page.has_more ?? false,
          requestId: Option.fromNullishOr(page.request_id).pipe(Option.map(PolygresError.redact)),
          metadata: pageMetadata(payload),
        },
        payload,
      ),
    ),
  )

export const readiness = (value: Schema.Schema.Type<typeof Readiness>): Runtime.Readiness => ({
  projectId: value.project_id,
  graph: readinessState(value.graph),
  vector: readinessState(value.vector),
  hybrid: readinessState(value.hybrid),
  requestId: Option.fromNullishOr(value.request_id).pipe(Option.map(PolygresError.redact)),
  metadata: value.metadata ?? {},
})

const readinessState = (value: { readonly ready: boolean; readonly default_config?: string | null }) => ({
  ready: value.ready,
  defaultConfig: Option.fromNullishOr(value.default_config),
})

export const connectionInfo = (value: Schema.Schema.Type<typeof ConnectionInfo>): Runtime.ConnectionInfo => ({
  projectId: value.project_id,
  projectMode: Option.fromNullishOr(value.project_mode ?? value.project?.project_mode),
  database: value.database,
  username: value.username,
  port: value.port,
  direct: {
    host: value.direct.host,
    urlWithoutPassword: value.direct.connection_string_without_password,
  },
  pooled: {
    host: value.pooled.host,
    urlWithoutPassword: value.pooled.connection_string_without_password,
  },
  requestId: Option.fromNullishOr(value.request_id).pipe(Option.map(PolygresError.redact)),
  metadata: value.metadata ?? {},
})

export const graphResult = (value: Schema.Schema.Type<typeof GraphResult>): Graph.Result => ({
  node: {
    schema: value.node.schema,
    table: value.node.table,
    id: String(value.node.id),
    properties: value.node.properties ?? value.properties ?? {},
  },
  depth: value.depth ?? 0,
  rank: Option.fromNullishOr(value.rank),
  graphScore: Option.fromNullishOr(value.graph_score),
  path: Option.fromNullishOr(value.path),
  edgePath: Option.fromNullishOr(value.edge_path),
  readablePath: Option.fromNullishOr(value.readable_path),
  relationships: value.relationships ?? [],
})

export const vectorResult = (value: Schema.Schema.Type<typeof VectorResult>): Vector.Result => ({
  schema: value.schema,
  table: value.table,
  id: String(value.id),
  properties: value.properties ?? {},
  distance: Option.fromNullishOr(value.distance),
  similarity: Option.fromNullishOr(value.similarity),
  score: Option.fromNullishOr(value.score),
})

export const textResult = (value: Schema.Schema.Type<typeof TextResult>): Text.Result => ({
  schema: value.schema,
  table: value.table,
  id: String(value.id),
  properties: value.properties ?? {},
  score: value.score,
  similarity: Option.fromNullishOr(value.similarity),
  key: Option.fromNullishOr(value.key),
})

export const hybridResult = (value: Schema.Schema.Type<typeof HybridResult>): Hybrid.Result => {
  const node = "node" in value ? value.node : value
  return {
    schema: node.schema,
    table: node.table,
    id: String(node.id),
    properties: value.properties ?? node.properties ?? {},
    score: value.score ?? value.final_score ?? value.rrf_score ?? 0,
    finalScore: Option.fromNullishOr(value.final_score),
    rrfScore: Option.fromNullishOr(value.rrf_score),
    vectorScore: Option.fromNullishOr(value.vector_score),
    graphScore: Option.fromNullishOr(value.graph_score),
    vectorRank: Option.fromNullishOr(value.vector_rank),
    graphRank: Option.fromNullishOr(value.graph_rank),
    graphDepth: Option.fromNullishOr(value.graph_depth),
    distance: Option.fromNullishOr(value.distance),
    similarity: Option.fromNullishOr(value.similarity),
    relationships: value.relationships ?? [],
  }
}

export const graphPathResponse = (
  value: Schema.Schema.Type<typeof GraphPathResponse>,
  payload: unknown,
): Graph.PathResponse => ({
  paths: value.paths,
  requestId: Option.fromNullishOr(value.request_id).pipe(Option.map(PolygresError.redact)),
  metadata: responseMetadata(payload, new Set(["paths", "request_id"])),
})

export const graphConnectionResponse = (
  value: Schema.Schema.Type<typeof GraphConnectionResponse>,
  payload: unknown,
): Graph.ConnectionResponse => ({
  connections: value.connections,
  requestId: Option.fromNullishOr(value.request_id).pipe(Option.map(PolygresError.redact)),
  metadata: responseMetadata(payload, new Set(["connections", "request_id"])),
})

export const responseMetadata = (
  payload: unknown,
  excluded: ReadonlySet<string>,
): Schema.Schema.Type<typeof JsonObject> => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {}
  const source = payload as Readonly<Record<string, Schema.Schema.Type<typeof Schema.Json>>>
  return Object.fromEntries(Object.entries(source).filter(([key]) => !excluded.has(key)))
}

const pageMetadata = (payload: unknown) =>
  responseMetadata(payload, new Set(["results", "next_cursor", "has_more", "request_id"]))

const requestId = (payload: unknown): string | undefined => {
  if (payload === null || typeof payload !== "object") return undefined
  const value = (payload as { readonly request_id?: unknown }).request_id
  return typeof value === "string" ? PolygresError.redact(value) : undefined
}
