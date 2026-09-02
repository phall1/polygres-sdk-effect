import { Schema } from "effect"

import { JsonObject } from "./Entity.js"

const Identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/), Schema.isMaxLength(63))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const Embedding = Schema.Array(Schema.Finite).check(Schema.isMinLength(1))
const PositivePointIds = Schema.Array(PositiveInt)
const NonBlank = Schema.String.check(
  Schema.makeFilter((value) => (value.trim().length === 0 ? "must not be blank" : undefined)),
)

export const FilterScalar = Schema.Union([Schema.Null, Schema.String, Schema.Finite, Schema.Boolean])
export type FilterScalar = Schema.Schema.Type<typeof FilterScalar>

export const FilterMatch = Schema.Union([
  FilterScalar,
  Schema.Struct({ value: FilterScalar }),
  Schema.Struct({ any: Schema.Array(FilterScalar).check(Schema.isMinLength(1), Schema.isMaxLength(1_000)) }),
  Schema.Struct({ except: Schema.Array(FilterScalar).check(Schema.isMinLength(1), Schema.isMaxLength(1_000)) }),
])
export type FilterMatch = Schema.Schema.Type<typeof FilterMatch>

export const FilterRange = Schema.Struct({
  gt: Schema.optionalKey(FilterScalar),
  gte: Schema.optionalKey(FilterScalar),
  lt: Schema.optionalKey(FilterScalar),
  lte: Schema.optionalKey(FilterScalar),
}).check(
  Schema.makeFilter((value) =>
    value.gt === undefined && value.gte === undefined && value.lt === undefined && value.lte === undefined
      ? "a range requires at least one bound"
      : undefined,
  ),
)
export interface FilterRange extends Schema.Schema.Type<typeof FilterRange> {}

export const FilterCondition = Schema.Union([
  Schema.Struct({ key: Identifier, match: FilterMatch }),
  Schema.Struct({ key: Identifier, range: FilterRange }),
  Schema.Struct({ key: Identifier, isNull: Schema.Boolean }),
  Schema.Struct({ key: Identifier, isEmpty: Schema.Boolean }),
]).check(Schema.makeFilter((value) => (value.key === "__polygres_source_id" ? "reserved filter key" : undefined)))
export type FilterCondition = Schema.Schema.Type<typeof FilterCondition>

const Conditions = Schema.Array(FilterCondition).check(Schema.isMinLength(1))
export const Filter = Schema.Struct({
  must: Schema.optionalKey(Conditions),
  should: Schema.optionalKey(Conditions),
  mustNot: Schema.optionalKey(Conditions),
}).check(
  Schema.makeFilter((value) =>
    value.must === undefined && value.should === undefined && value.mustNot === undefined
      ? "a filter requires at least one condition lane"
      : undefined,
  ),
  Schema.makeFilter((value) => {
    const lanes = [value.must ?? [], value.should ?? [], value.mustNot ?? []]
    const conditions = lanes.flat()
    if (conditions.length > 256) return "filter must not exceed 256 condition nodes"

    let values = 0
    for (const condition of conditions) {
      if ("match" in condition) {
        const match = condition.match
        values +=
          match !== null && typeof match === "object"
            ? "any" in match
              ? match.any.length
              : "except" in match
                ? match.except.length
                : 1
            : 1
      } else if ("range" in condition) {
        values += Object.keys(condition.range).length
      }
    }
    if (values > 2_000) return "filter must not exceed 2000 scalar values"

    const wire = {
      ...(value.must === undefined ? {} : { must: value.must }),
      ...(value.should === undefined ? {} : { should: value.should }),
      ...(value.mustNot === undefined ? {} : { must_not: value.mustNot }),
    }
    return new TextEncoder().encode(JSON.stringify(wire)).length > 65_536
      ? "filter must not exceed 65536 UTF-8 bytes"
      : undefined
  }),
)
export interface Filter extends Schema.Schema.Type<typeof Filter> {}

export const QueryPlanFilter = Schema.NullOr(JsonObject)
export type QueryPlanFilter = Schema.Schema.Type<typeof QueryPlanFilter>

export interface NearestPlan {
  readonly kind: "nearest"
  readonly vector: ReadonlyArray<number>
  readonly limit: number
  readonly vectorName?: string
  readonly filter?: QueryPlanFilter
}

export interface SparseNearestPlan {
  readonly kind: "sparse_nearest"
  readonly vectorName: string
  readonly vector: string
  readonly limit: number
  readonly filter?: QueryPlanFilter
}

export interface FullTextPlan {
  readonly kind: "full_text"
  readonly textQuery: string
  readonly textColumn: string
  readonly limit: number
}

export interface LateInteractionPlan {
  readonly kind: "late_interaction"
  readonly queryVectors: ReadonlyArray<ReadonlyArray<number>>
  readonly candidatesPerQuery: number
  readonly limit: number
}

export interface RecommendPlan {
  readonly kind: "recommend"
  readonly positivePointIds: ReadonlyArray<number>
  readonly negativePointIds: ReadonlyArray<number>
  readonly limit: number
}

export interface DiscoverPlan {
  readonly kind: "discover"
  readonly contextPointIds: ReadonlyArray<number>
  readonly limit: number
}

export interface LookupPlan {
  readonly kind: "lookup"
  readonly pointIds: ReadonlyArray<number>
}

export interface PrefetchPlan {
  readonly kind: "prefetch"
  readonly branches: ReadonlyArray<QueryPlan>
}

export interface WeightPlan {
  readonly kind: "weight"
  readonly branch: QueryPlan
  readonly weight: number
}

export interface ScoreThresholdPlan {
  readonly kind: "score_threshold"
  readonly branch: QueryPlan
  readonly minScore?: number
  readonly maxScore?: number
}

export interface FormulaPlan {
  readonly kind: "formula"
  readonly branch: QueryPlan
  readonly formula: string
}

export interface RerankPlan {
  readonly kind: "rerank"
  readonly branch: QueryPlan
  readonly limit: number
}

export type QueryPlan =
  | NearestPlan
  | SparseNearestPlan
  | FullTextPlan
  | LateInteractionPlan
  | RecommendPlan
  | DiscoverPlan
  | LookupPlan
  | PrefetchPlan
  | WeightPlan
  | ScoreThresholdPlan
  | FormulaPlan
  | RerankPlan

type Decodable<A> = Schema.Schema<A> & { readonly DecodingServices: never }

const QueryBranch = Schema.suspend((): Decodable<QueryPlan> => QueryPlan)

export const QueryPlan = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("nearest"),
    vector: Embedding,
    limit: PositiveInt,
    vectorName: Schema.optionalKey(Identifier),
    filter: Schema.optionalKey(QueryPlanFilter),
  }),
  Schema.Struct({
    kind: Schema.Literal("sparse_nearest"),
    vectorName: Identifier,
    vector: NonBlank,
    limit: PositiveInt,
    filter: Schema.optionalKey(QueryPlanFilter),
  }),
  Schema.Struct({
    kind: Schema.Literal("full_text"),
    textQuery: NonBlank,
    textColumn: Identifier,
    limit: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("late_interaction"),
    queryVectors: Schema.Array(Embedding).check(Schema.isMinLength(1)),
    candidatesPerQuery: PositiveInt,
    limit: PositiveInt,
  }).check(
    Schema.makeFilter((value) => {
      const dimensions = value.queryVectors[0]?.length
      return value.queryVectors.every((vector) => vector.length === dimensions)
        ? undefined
        : "query vectors must have matching dimensions"
    }),
  ),
  Schema.Struct({
    kind: Schema.Literal("recommend"),
    positivePointIds: PositivePointIds.check(Schema.isMinLength(1)),
    negativePointIds: PositivePointIds,
    limit: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("discover"),
    contextPointIds: PositivePointIds.check(Schema.isMinLength(1)),
    limit: PositiveInt,
  }),
  Schema.Struct({ kind: Schema.Literal("lookup"), pointIds: PositivePointIds.check(Schema.isMinLength(1)) }),
  Schema.Struct({ kind: Schema.Literal("prefetch"), branches: Schema.Array(QueryBranch).check(Schema.isMinLength(1)) }),
  Schema.Struct({
    kind: Schema.Literal("weight"),
    branch: QueryBranch,
    weight: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    kind: Schema.Literal("score_threshold"),
    branch: QueryBranch,
    minScore: Schema.optionalKey(Schema.Finite),
    maxScore: Schema.optionalKey(Schema.Finite),
  }).check(
    Schema.makeFilter((value) =>
      value.minScore !== undefined && value.maxScore !== undefined && value.minScore > value.maxScore
        ? "minScore must not exceed maxScore"
        : undefined,
    ),
  ),
  Schema.Struct({
    kind: Schema.Literal("formula"),
    branch: QueryBranch,
    formula: NonBlank,
  }),
  Schema.Struct({ kind: Schema.Literal("rerank"), branch: QueryBranch, limit: PositiveInt }),
]) as Decodable<QueryPlan>

const decodePlan = Schema.decodeUnknownSync(QueryPlan, { onExcessProperty: "error" })

const immutable = <A>(value: A): A => {
  if (Array.isArray(value)) {
    for (const item of value) immutable(item)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) immutable(item)
    return Object.freeze(value)
  }
  return value
}

const plan = (value: unknown): QueryPlan => immutable(decodePlan(value))

export const queryNearest = (
  vector: ReadonlyArray<number>,
  limit = 10,
  options: { readonly vectorName?: string; readonly filter?: QueryPlanFilter } = {},
): NearestPlan => plan({ kind: "nearest", vector, limit, ...options }) as NearestPlan

export const querySparseNearest = (
  vectorName: string,
  vector: string,
  limit = 10,
  options: { readonly filter?: QueryPlanFilter } = {},
): SparseNearestPlan => plan({ kind: "sparse_nearest", vectorName, vector, limit, ...options }) as SparseNearestPlan

export const queryFullText = (textQuery: string, textColumn: string, limit = 10): FullTextPlan =>
  plan({ kind: "full_text", textQuery, textColumn, limit }) as FullTextPlan

export const queryLateInteraction = (
  queryVectors: ReadonlyArray<ReadonlyArray<number>>,
  candidatesPerQuery: number,
  limit = 10,
): LateInteractionPlan =>
  plan({ kind: "late_interaction", queryVectors, candidatesPerQuery, limit }) as LateInteractionPlan

export const queryRecommend = (
  positivePointIds: ReadonlyArray<number>,
  negativePointIds: ReadonlyArray<number>,
  limit = 10,
): RecommendPlan => plan({ kind: "recommend", positivePointIds, negativePointIds, limit }) as RecommendPlan

export const queryDiscover = (contextPointIds: ReadonlyArray<number>, limit = 10): DiscoverPlan =>
  plan({ kind: "discover", contextPointIds, limit }) as DiscoverPlan

export const queryLookup = (pointIds: ReadonlyArray<number>): LookupPlan =>
  plan({ kind: "lookup", pointIds }) as LookupPlan

export const queryPrefetch = (branches: ReadonlyArray<QueryPlan>): PrefetchPlan =>
  plan({ kind: "prefetch", branches }) as PrefetchPlan

export const queryWeight = (branch: QueryPlan, weight: number): WeightPlan =>
  plan({ kind: "weight", branch, weight }) as WeightPlan

export const queryScoreThreshold = (branch: QueryPlan, minScore?: number, maxScore?: number): ScoreThresholdPlan =>
  plan({
    kind: "score_threshold",
    branch,
    ...(minScore === undefined ? {} : { minScore }),
    ...(maxScore === undefined ? {} : { maxScore }),
  }) as ScoreThresholdPlan

export const queryFormula = (branch: QueryPlan, formula: string): FormulaPlan =>
  plan({ kind: "formula", branch, formula }) as FormulaPlan

export const queryRerank = (branch: QueryPlan, limit: number): RerankPlan =>
  plan({ kind: "rerank", branch, limit }) as RerankPlan
