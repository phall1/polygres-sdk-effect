import type { Effect, Layer, Stream } from "effect"
import type { HttpClient } from "effect/unstable/http"

import { type Graph, Polygres, type PolygresError, type Runtime, type Vector } from "../src/index.js"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false
type Assert<Value extends true> = Value
type EffectSuccess<Value> =
  Value extends Effect.Effect<infer Success, infer _Error, infer _Requirements> ? Success : never
type EffectError<Value> = Value extends Effect.Effect<infer _Success, infer Error, infer _Requirements> ? Error : never
type EffectRequirements<Value> =
  Value extends Effect.Effect<infer _Success, infer _Error, infer Requirements> ? Requirements : never
type StreamSuccess<Value> =
  Value extends Stream.Stream<infer Success, infer _Error, infer _Requirements> ? Success : never
type LayerRequirements<Value> =
  Value extends Layer.Layer<infer _Success, infer _Error, infer Requirements> ? Requirements : never

declare const client: Polygres.Service
declare const computedEmbedding: number[]

const readiness = client.readiness()
const vectorPage = client.vector.search.page({ embedding: [0.1], minSimilarity: 0.8 })
const vectorStream = client.vector.search.stream({ embedding: [0.1], minSimilarity: 0.8 })
const computedVectorPage = client.vector.search.page({ embedding: computedEmbedding })
const graphPath = client.graph.path({
  source: { schema: "public", table: "entities", id: "a" },
  target: { schema: "public", table: "entities", id: "b" },
})
const constructed = Polygres.make({
  apiKey: "poly_live_0123456789abcdef0123456789abcdef",
  projectId: "p0123456789abcdef0123456",
})
const live = Polygres.layer({
  apiKey: "poly_live_0123456789abcdef0123456789abcdef",
  projectId: "p0123456789abcdef0123456",
})

export type ReadinessSuccess = Assert<Equal<EffectSuccess<typeof readiness>, Runtime.Readiness>>
export type ReadinessExcludesInputFailure = Assert<
  PolygresError.InvalidInput extends EffectError<typeof readiness> ? false : true
>
export type SearchErrorIsNarrow = Assert<Equal<EffectError<typeof vectorPage>, PolygresError.Search>>
export type PageResultInference = Assert<Equal<EffectSuccess<typeof vectorPage>["items"][number], Vector.Result>>
export type StreamResultInference = Assert<Equal<StreamSuccess<typeof vectorStream>, Vector.Result>>
export type ComputedEmbeddingInference = Assert<
  Equal<EffectSuccess<typeof computedVectorPage>, EffectSuccess<typeof vectorPage>>
>
export type GraphPathInference = Assert<Equal<EffectSuccess<typeof graphPath>, Graph.PathResponse>>
export type ConstructionFailure = Assert<Equal<EffectError<typeof constructed>, PolygresError.Configuration>>
export type ConstructionRequirement = Assert<Equal<EffectRequirements<typeof constructed>, HttpClient.HttpClient>>
export type LayerRequirement = Assert<Equal<LayerRequirements<typeof live>, HttpClient.HttpClient>>

// @ts-expect-error Paginated calls accept one schema-owned object input.
client.vector.search.page([0.1])

// @ts-expect-error Cursor ownership belongs to stream pagination.
client.vector.search.stream({ embedding: [0.1], cursor: "opaque" })

// @ts-expect-error Related retrieval is always exactly one hop.
client.graph.related.page({ start: { schema: "public", table: "entities", id: "a" }, maxDepth: 2 })

// @ts-expect-error The pinned Runtime contract accepts one expansion start.
client.graph.expand.page({ start: [{ schema: "public", table: "entities", id: "a" }] })

// @ts-expect-error Public Runtime models do not leak wire casing.
declare const leakedWireName: Runtime.Readiness["project_id"]
