import { Effect, Option, Schema } from "effect"

import { Filter, QueryPlan } from "./ContextQuery.js"
import { JsonObject } from "./Entity.js"

export { QueryPlan as ContextQueryPlan } from "./ContextQuery.js"

const named = <S extends Schema.Top>(identifier: string, schema: S): S =>
  schema.pipe(Schema.annotate({ identifier: `Polygres.Context.${identifier}` })) as S

const defaultKey = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)))

const nonBlank = Schema.makeFilter((value: string) => (value.trim().length === 0 ? "must not be blank" : undefined))
export const Identifier = named(
  "Identifier",
  Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/), Schema.isMaxLength(63)),
)
export type Identifier = Schema.Schema.Type<typeof Identifier>
export const Uuid = named(
  "Uuid",
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)),
)
export type Uuid = Schema.Schema.Type<typeof Uuid>
export const CollectionRef = named("CollectionRef", Schema.Union([Uuid, Identifier]))
export type CollectionRef = Schema.Schema.Type<typeof CollectionRef>
export const IdempotencyKey = named(
  "IdempotencyKey",
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128), Schema.isPattern(/^[\x20-\x7e]+$/)),
)
export type IdempotencyKey = Schema.Schema.Type<typeof IdempotencyKey>
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Limit = PositiveInt.check(Schema.isLessThanOrEqualTo(1_000))
export const AdminPageLimit = named("AdminPageLimit", PositiveInt.check(Schema.isLessThanOrEqualTo(100)))
export type AdminPageLimit = Schema.Schema.Type<typeof AdminPageLimit>
export const PointPageLimit = named("PointPageLimit", PositiveInt.check(Schema.isLessThanOrEqualTo(100)))
export type PointPageLimit = Schema.Schema.Type<typeof PointPageLimit>
const Dimensions = PositiveInt.check(Schema.isLessThanOrEqualTo(16_000))
const Embedding = Schema.Array(Schema.Finite).check(Schema.isMinLength(1))
const SourceKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => (value.includes("\0") ? "must not contain NUL" : undefined)),
  Schema.makeFilter((value) =>
    new TextEncoder().encode(value).length > 1_024 ? "must not exceed 1024 UTF-8 bytes" : undefined,
  ),
)
const SourceKeys = Schema.Array(SourceKey).check(Schema.isMinLength(1), Schema.isMaxLength(10_000))
const DateTime = Schema.DateTimeUtcFromString
const OptionalString = Schema.OptionFromNullOr(Schema.String)
const OptionalInt = Schema.OptionFromNullOr(Schema.Int)
const OptionalFinite = Schema.OptionFromNullOr(Schema.Finite)
const OptionalDateTime = Schema.OptionFromNullOr(DateTime)
const OptionalUuid = Schema.OptionFromNullOr(Uuid)

export const Metric = named("Metric", Schema.Literals(["cosine", "inner_product", "l2", "l1"]))
export type Metric = Schema.Schema.Type<typeof Metric>
export const IndexKind = named("IndexKind", Schema.Literals(["none", "hnsw"]))
export type IndexKind = Schema.Schema.Type<typeof IndexKind>
export const SourceMode = named("SourceMode", Schema.Literals(["existing", "add_column", "new_table"]))
export type SourceMode = Schema.Schema.Type<typeof SourceMode>
export const GraphDirection = named("GraphDirection", Schema.Literals(["out", "in", "any", "both"]))
export type GraphDirection = Schema.Schema.Type<typeof GraphDirection>
export const CollectionStatus = named("CollectionStatus", Schema.Literals(["ready", "stale", "failed", "deleting"]))
export type CollectionStatus = Schema.Schema.Type<typeof CollectionStatus>
export const ServingStatus = named("ServingStatus", Schema.Literals(["available", "blocked"]))
export type ServingStatus = Schema.Schema.Type<typeof ServingStatus>
export const IndexStatus = named("IndexStatus", Schema.Literals(["missing", "creating", "ready", "stale", "failed"]))
export type IndexStatus = Schema.Schema.Type<typeof IndexStatus>
export const PointReconciliationStatus = named(
  "PointReconciliationStatus",
  Schema.Literals(["pending", "reconciling", "current", "stale", "failed"]),
)
export type PointReconciliationStatus = Schema.Schema.Type<typeof PointReconciliationStatus>
export const OnboardingStatus = named(
  "OnboardingStatus",
  Schema.Literals(["unassessed", "eligible", "dismissed", "completed", "ineligible"]),
)
export type OnboardingStatus = Schema.Schema.Type<typeof OnboardingStatus>
export const SourceClassification = named(
  "SourceClassification",
  Schema.Literals(["ready_to_configure", "needs_setup", "unsupported", "vector_source"]),
)
export type SourceClassification = Schema.Schema.Type<typeof SourceClassification>
export const FilterKind = named("FilterKind", Schema.Literals(["column", "jsonb_path"]))
export type FilterKind = Schema.Schema.Type<typeof FilterKind>
export const OperationKind = named(
  "OperationKind",
  Schema.Literals([
    "collection_create",
    "collection_set_default",
    "collection_update",
    "collection_delete",
    "collection_reindex",
    "vector_add",
    "filter_add_column",
    "filter_add_jsonb_path",
    "points_upsert",
    "points_delete",
    "points_reconcile",
  ]),
)
export type OperationKind = Schema.Schema.Type<typeof OperationKind>
export const OperationStatus = named(
  "OperationStatus",
  Schema.Literals(["queued", "running", "cancel_requested", "succeeded", "failed", "cancelled"]),
)
export type OperationStatus = Schema.Schema.Type<typeof OperationStatus>
export const RankedMode = named(
  "RankedMode",
  Schema.Literals(["dense", "text_hybrid", "graph_first", "vector_first", "rank_fusion", "joint"]),
)
export type RankedMode = Schema.Schema.Type<typeof RankedMode>
export const ScoreKind = named(
  "ScoreKind",
  Schema.Literals(["context_metric", "rrf", "weighted_rrf", "joint_weighted_rrf"]),
)
export type ScoreKind = Schema.Schema.Type<typeof ScoreKind>

export const EmptyRequest = named("EmptyRequest", Schema.Struct({}))
export interface EmptyRequest extends Schema.Schema.Type<typeof EmptyRequest> {}

export const DiscoveryRequest = named(
  "DiscoveryRequest",
  Schema.Struct({
    schemaNames: defaultKey(Schema.NullOr(Schema.Array(Identifier).check(Schema.isMinLength(1))), null),
  }),
)
export interface DiscoveryRequest extends Schema.Schema.Type<typeof DiscoveryRequest> {}

export const SourceRequest = named(
  "SourceRequest",
  Schema.Struct({
    mode: SourceMode,
    schemaName: Identifier,
    tableName: Identifier,
    sourceKeyColumn: defaultKey(Schema.Literal("id"), "id"),
    contentColumn: defaultKey(Schema.NullOr(Identifier), null),
    metadataColumn: defaultKey(Schema.NullOr(Identifier), null),
  }).check(
    Schema.makeFilter((value) =>
      value.mode !== "new_table" && (value.contentColumn != null || value.metadataColumn != null)
        ? "contentColumn and metadataColumn require new_table mode"
        : undefined,
    ),
  ),
)
export interface SourceRequest extends Schema.Schema.Type<typeof SourceRequest> {}
export { SourceRequest as ContextSourceRequest }

export const VectorRequest = named(
  "VectorRequest",
  Schema.Struct({
    name: defaultKey(Schema.NullOr(Identifier), null),
    columnName: defaultKey(Identifier, "embedding"),
    dimensions: Dimensions,
    metric: defaultKey(Metric, "cosine"),
  }),
)
export interface VectorRequest extends Schema.Schema.Type<typeof VectorRequest> {}
export { VectorRequest as ContextVectorRequest }

export const VectorCreateRequest = named(
  "VectorCreateRequest",
  Schema.Struct({
    name: defaultKey(Schema.NullOr(Identifier), null),
    columnName: defaultKey(Identifier, "embedding"),
    dimensions: Dimensions,
    metric: defaultKey(Metric, "cosine"),
    mode: defaultKey(Schema.Literals(["existing", "add_column"]), "existing"),
    indexKind: defaultKey(IndexKind, "hnsw"),
    setDefault: defaultKey(Schema.Boolean, false),
  }),
)
export interface VectorCreateRequest extends Schema.Schema.Type<typeof VectorCreateRequest> {}
export { VectorCreateRequest as ContextVectorCreateRequest }

export const JsonbFilterPathRequest = named(
  "JsonbFilterPathRequest",
  Schema.Struct({
    key: Identifier,
    column: Identifier,
    path: Schema.Array(
      Schema.String.check(
        Schema.isMinLength(1),
        Schema.makeFilter((value) => (value.includes("\0") ? "must not contain NUL" : undefined)),
        Schema.makeFilter((value) =>
          new TextEncoder().encode(value).length > 512 ? "must not exceed 512 UTF-8 bytes" : undefined,
        ),
      ),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  }).check(Schema.makeFilter((value) => (value.key === "__polygres_source_id" ? "reserved filter key" : undefined))),
)
export interface JsonbFilterPathRequest extends Schema.Schema.Type<typeof JsonbFilterPathRequest> {}

const UniqueIdentifiers = Schema.Array(Identifier).check(
  Schema.isMaxLength(32),
  Schema.makeFilter((values) => (new Set(values).size === values.length ? undefined : "must not contain duplicates")),
  Schema.makeFilter((values) =>
    values.includes("__polygres_source_id") ? "contains a reserved filter key" : undefined,
  ),
)

export const CollectionCreateRequest = named(
  "CollectionCreateRequest",
  Schema.Struct({
    name: Identifier,
    source: SourceRequest,
    vector: VectorRequest,
    textColumn: defaultKey(Schema.NullOr(Identifier), null),
    resultColumns: defaultKey(UniqueIdentifiers, []),
    filterColumns: defaultKey(UniqueIdentifiers, []),
    jsonbFilterPaths: defaultKey(Schema.Array(JsonbFilterPathRequest).check(Schema.isMaxLength(32)), []),
    indexKind: defaultKey(IndexKind, "hnsw"),
    maxSearchLimit: defaultKey(Limit, 1_000),
  }).check(
    Schema.makeFilter((value) => {
      const keys = [...(value.filterColumns ?? []), ...(value.jsonbFilterPaths ?? []).map((item) => item.key)]
      return new Set(keys).size === keys.length ? undefined : "filter keys must be unique"
    }),
  ),
)
export interface CollectionCreateRequest extends Schema.Schema.Type<typeof CollectionCreateRequest> {}

export const CollectionSetDefaultRequest = named(
  "CollectionSetDefaultRequest",
  Schema.Struct({ isDefault: Schema.Literal(true) }),
)
export interface CollectionSetDefaultRequest extends Schema.Schema.Type<typeof CollectionSetDefaultRequest> {}

const UpdateResultColumns = Schema.Array(Identifier).check(
  Schema.isMaxLength(32),
  Schema.makeFilter((values) => (new Set(values).size === values.length ? undefined : "must not contain duplicates")),
)

export const CollectionUpdateRequest = named(
  "CollectionUpdateRequest",
  Schema.Struct({
    textColumn: Schema.optionalKey(Schema.NullOr(Identifier)),
    resultColumns: Schema.optionalKey(Schema.NullOr(UpdateResultColumns)),
    maxSearchLimit: Schema.optionalKey(Schema.NullOr(Limit)),
    defaultVectorName: Schema.optionalKey(Schema.NullOr(Identifier)),
  }).check(
    Schema.makeFilter((value) =>
      Object.keys(value).length === 0 ? "at least one logical field is required" : undefined,
    ),
  ),
)
export interface CollectionUpdateRequest extends Schema.Schema.Type<typeof CollectionUpdateRequest> {}

export const CollectionDeleteRequest = named("CollectionDeleteRequest", Schema.Struct({ confirmCollectionId: Uuid }))
export interface CollectionDeleteRequest extends Schema.Schema.Type<typeof CollectionDeleteRequest> {}
export const CollectionAliasRequest = named(
  "CollectionAliasRequest",
  Schema.Struct({ aliasName: Identifier, targetCollectionName: Identifier }),
)
export interface CollectionAliasRequest extends Schema.Schema.Type<typeof CollectionAliasRequest> {}

export const CollectionLimitsRequest = named(
  "CollectionLimitsRequest",
  Schema.Struct({
    strictMode: Schema.Boolean,
    maxDimensions: Schema.optionalKey(Schema.NullOr(Dimensions)),
    maxVectors: Schema.optionalKey(Schema.NullOr(PositiveInt)),
    maxPoints: Schema.optionalKey(Schema.NullOr(PositiveInt)),
    maxFilterNodes: Schema.optionalKey(Schema.NullOr(PositiveInt)),
    maxSearchLimit: Schema.optionalKey(Schema.NullOr(PositiveInt)),
    maxCandidateBudget: Schema.optionalKey(Schema.NullOr(PositiveInt)),
    queryTimeoutMs: Schema.optionalKey(Schema.NullOr(PositiveInt)),
    maxIndexMemoryBytes: Schema.optionalKey(Schema.NullOr(PositiveInt)),
  }),
)
export interface CollectionLimitsRequest extends Schema.Schema.Type<typeof CollectionLimitsRequest> {}

export const VectorConfigureRequest = named(
  "VectorConfigureRequest",
  Schema.Struct({
    hnswOptions: JsonObject,
    quantizationOptions: JsonObject,
    status: Schema.Literals(["ready", "building", "disabled", "failed"]),
  }),
)
export interface VectorConfigureRequest extends Schema.Schema.Type<typeof VectorConfigureRequest> {}

export const FilterColumnRequest = named(
  "FilterColumnRequest",
  Schema.Struct({ key: Identifier, column: Identifier }).check(
    Schema.makeFilter((value) => (value.key === "__polygres_source_id" ? "reserved filter key" : undefined)),
  ),
)
export interface FilterColumnRequest extends Schema.Schema.Type<typeof FilterColumnRequest> {}
export const FilterJsonbPathRequest = JsonbFilterPathRequest
export interface FilterJsonbPathRequest extends Schema.Schema.Type<typeof FilterJsonbPathRequest> {}

export const PointKeysRequest = named("PointKeysRequest", Schema.Struct({ sourceKeys: SourceKeys }))
export interface PointKeysRequest extends Schema.Schema.Type<typeof PointKeysRequest> {}
export const BulkPointKeysRequest = named(
  "BulkPointKeysRequest",
  Schema.Struct({ sourceKeys: SourceKeys, collection: CollectionRef, batchSize: defaultKey(PositiveInt, 1_000) }),
)
export interface BulkPointKeysRequest extends Schema.Schema.Type<typeof BulkPointKeysRequest> {}
export const BackfillPointsRequest = named(
  "BackfillPointsRequest",
  Schema.Struct({ collection: CollectionRef, batchSize: defaultKey(PositiveInt, 1_000) }),
)
export interface BackfillPointsRequest extends Schema.Schema.Type<typeof BackfillPointsRequest> {}
export const SetPayloadRequest = named(
  "SetPayloadRequest",
  Schema.Struct({
    sourceKeys: SourceKeys,
    collection: CollectionRef,
    payload: JsonObject.check(Schema.isMinProperties(1)),
  }),
)
export interface SetPayloadRequest extends Schema.Schema.Type<typeof SetPayloadRequest> {}
export const DeletePayloadRequest = named(
  "DeletePayloadRequest",
  Schema.Struct({
    sourceKeys: SourceKeys,
    collection: CollectionRef,
    payloadKeys: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  }),
)
export interface DeletePayloadRequest extends Schema.Schema.Type<typeof DeletePayloadRequest> {}
export const ClearPayloadRequest = named(
  "ClearPayloadRequest",
  Schema.Struct({ sourceKeys: SourceKeys, collection: CollectionRef }),
)
export interface ClearPayloadRequest extends Schema.Schema.Type<typeof ClearPayloadRequest> {}

export const CountRequest = named(
  "CountRequest",
  Schema.Struct({ collection: CollectionRef, filter: defaultKey(Schema.NullOr(Filter), null) }),
)
export interface CountRequest extends Schema.Schema.Type<typeof CountRequest> {}
export const FacetsRequest = named(
  "FacetsRequest",
  Schema.Struct({
    collection: CollectionRef,
    filter: defaultKey(Schema.NullOr(Filter), null),
    field: Identifier,
    limit: defaultKey(Limit, 10),
  }),
)
export interface FacetsRequest extends Schema.Schema.Type<typeof FacetsRequest> {}
export const DenseSearchRequest = named(
  "DenseSearchRequest",
  Schema.Struct({
    collection: CollectionRef,
    vectorName: defaultKey(Schema.NullOr(Identifier), null),
    embedding: Embedding,
    filter: defaultKey(Schema.NullOr(Filter), null),
    limit: defaultKey(Limit, 10),
  }),
)
export interface DenseSearchRequest extends Schema.Schema.Type<typeof DenseSearchRequest> {}
export const CandidateSearchRequest = named(
  "CandidateSearchRequest",
  Schema.Struct({
    collection: CollectionRef,
    vectorName: defaultKey(Schema.NullOr(Identifier), null),
    embedding: Embedding,
    filter: defaultKey(Schema.NullOr(Filter), null),
    limit: defaultKey(Limit, 10),
    candidatePointIds: Schema.Array(PositiveInt).check(Schema.isMinLength(1)),
  }),
)
export interface CandidateSearchRequest extends Schema.Schema.Type<typeof CandidateSearchRequest> {}

const PointRecommend = Schema.Struct({
  collection: CollectionRef,
  positivePointIds: Schema.Array(PositiveInt).check(Schema.isMinLength(1)),
  negativePointIds: defaultKey(Schema.Array(PositiveInt), []),
  limit: defaultKey(Limit, 10),
})
const VectorRecommend = Schema.Struct({
  collection: CollectionRef,
  positiveVectors: Schema.Array(Embedding).check(Schema.isMinLength(1)),
  negativeVectors: defaultKey(Schema.Array(Embedding), []),
  limit: defaultKey(Limit, 10),
})
export const RecommendRequest = named("RecommendRequest", Schema.Union([PointRecommend, VectorRecommend]))
export type RecommendRequest = Schema.Schema.Type<typeof RecommendRequest>

export const PointDiscoveryRequest = named(
  "PointDiscoveryRequest",
  Schema.Struct({
    collection: CollectionRef,
    contextPointIds: Schema.Array(PositiveInt).check(Schema.isMinLength(1)),
    limit: defaultKey(Limit, 10),
  }),
)
export interface PointDiscoveryRequest extends Schema.Schema.Type<typeof PointDiscoveryRequest> {}
export { PointDiscoveryRequest as ContextPointDiscoveryRequest }

const ModelText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => ([...value].length <= 128 ? undefined : "must not exceed 128 Unicode code points")),
)
export const RegisterModelVersionRequest = named(
  "RegisterModelVersionRequest",
  Schema.Struct({
    collection: CollectionRef,
    modelName: ModelText,
    modelVersion: ModelText,
    dimensions: Dimensions,
    metric: Metric,
  }),
)
export interface RegisterModelVersionRequest extends Schema.Schema.Type<typeof RegisterModelVersionRequest> {}
export const CreateEmbeddingMigrationRequest = named(
  "CreateEmbeddingMigrationRequest",
  Schema.Struct({
    collection: CollectionRef,
    sourceModelName: ModelText,
    sourceModelVersion: ModelText,
    targetModelName: ModelText,
    targetModelVersion: ModelText,
    totalPoints: NonNegativeInt,
  }),
)
export interface CreateEmbeddingMigrationRequest extends Schema.Schema.Type<typeof CreateEmbeddingMigrationRequest> {}
export const UpdateEmbeddingMigrationRequest = named(
  "UpdateEmbeddingMigrationRequest",
  Schema.Struct({
    processedPoints: NonNegativeInt,
    status: Schema.Literals(["planned", "running", "completed", "failed"]),
  }),
)
export interface UpdateEmbeddingMigrationRequest extends Schema.Schema.Type<typeof UpdateEmbeddingMigrationRequest> {}

export const RawVectorSearchRequest = named(
  "RawVectorSearchRequest",
  Schema.Struct({
    query: Embedding,
    pointIds: Schema.Array(NonNegativeInt).check(Schema.isMinLength(1)),
    vectors: Schema.Array(Embedding).check(Schema.isMinLength(1)),
    metric: Metric,
    limit: defaultKey(Limit, 10),
  }).check(
    Schema.makeFilter((value) =>
      value.pointIds.length === value.vectors.length ? undefined : "pointIds and vectors must have the same length",
    ),
    Schema.makeFilter((value) =>
      value.vectors.every((vector) => vector.length === value.query.length)
        ? undefined
        : "candidate vector dimensions must match query",
    ),
  ),
)
export interface RawVectorSearchRequest extends Schema.Schema.Type<typeof RawVectorSearchRequest> {}

export const GroupedSearchRequest = named(
  "GroupedSearchRequest",
  Schema.Struct({
    collection: CollectionRef,
    vectorName: defaultKey(Schema.NullOr(Identifier), null),
    embedding: Embedding,
    groupBy: Identifier,
    groupLimit: defaultKey(Limit, 1),
    limit: defaultKey(Limit, 10),
  }),
)
export interface GroupedSearchRequest extends Schema.Schema.Type<typeof GroupedSearchRequest> {}
export const RecallCheckRequest = named(
  "RecallCheckRequest",
  Schema.Struct({
    collection: CollectionRef,
    vectorName: defaultKey(Schema.NullOr(Identifier), null),
    embedding: Embedding,
    filter: defaultKey(Schema.NullOr(Filter), null),
    limit: defaultKey(Limit, 10),
    minimumRecall: defaultKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })), 0.95),
  }),
)
export interface RecallCheckRequest extends Schema.Schema.Type<typeof RecallCheckRequest> {}
export const TextHybridSearchRequest = named(
  "TextHybridSearchRequest",
  Schema.Struct({
    collection: CollectionRef,
    vectorName: defaultKey(Schema.NullOr(Identifier), null),
    embedding: Embedding,
    query: Schema.String.check(nonBlank),
    limit: defaultKey(Limit, 10),
  }),
)
export interface TextHybridSearchRequest extends Schema.Schema.Type<typeof TextHybridSearchRequest> {}

export const GraphStart = named("GraphStart", Schema.Struct({ schema: Identifier, table: Identifier, id: SourceKey }))
export interface GraphStart extends Schema.Schema.Type<typeof GraphStart> {}
const GraphSearchFields = {
  collection: CollectionRef,
  vectorName: defaultKey(Schema.NullOr(Identifier), null),
  embedding: Embedding,
  filter: defaultKey(Schema.NullOr(Filter), null),
  limit: defaultKey(Limit, 10),
  maxDepth: defaultKey(PositiveInt.check(Schema.isLessThanOrEqualTo(20)), 2),
  graphLimit: defaultKey(Limit, 200),
  relationshipTypes: defaultKey(Schema.Array(Identifier).check(Schema.isMaxLength(32)), []),
  direction: defaultKey(GraphDirection, "any"),
}
export const GraphFirstSearchRequest = named(
  "GraphFirstSearchRequest",
  Schema.Struct({ ...GraphSearchFields, start: GraphStart }),
)
export interface GraphFirstSearchRequest extends Schema.Schema.Type<typeof GraphFirstSearchRequest> {}
export const VectorFirstSearchRequest = named(
  "VectorFirstSearchRequest",
  Schema.Struct({ ...GraphSearchFields, contextLimit: defaultKey(Limit, 50) }),
)
export interface VectorFirstSearchRequest extends Schema.Schema.Type<typeof VectorFirstSearchRequest> {}

const validateWeights = (value: ReadonlyArray<number>) =>
  value.some((item) => !Number.isFinite(item) || item < 0)
    ? "weights must be finite and non-negative"
    : value.every((item) => item === 0)
      ? "at least one weight must be positive"
      : undefined
export const RankFusionWeights = named(
  "RankFusionWeights",
  Schema.Struct({ context: defaultKey(Schema.Finite, 0.7), graph: defaultKey(Schema.Finite, 0.3) }).check(
    Schema.makeFilter((value) => validateWeights([value.context ?? 0.7, value.graph ?? 0.3])),
  ),
)
export interface RankFusionWeights extends Schema.Schema.Type<typeof RankFusionWeights> {}
export const RankFusionSearchRequest = named(
  "RankFusionSearchRequest",
  Schema.Struct({
    ...GraphSearchFields,
    start: GraphStart,
    contextLimit: defaultKey(Limit, 50),
    weights: defaultKey(RankFusionWeights, {}),
  }),
)
export interface RankFusionSearchRequest extends Schema.Schema.Type<typeof RankFusionSearchRequest> {}
export const JointWeights = named(
  "JointWeights",
  Schema.Struct({
    semantic: defaultKey(Schema.Finite, 0.7),
    lexical: defaultKey(Schema.Finite, 0),
    graph: defaultKey(Schema.Finite, 0.3),
  }).check(
    Schema.makeFilter((value) => validateWeights([value.semantic ?? 0.7, value.lexical ?? 0, value.graph ?? 0.3])),
  ),
)
export interface JointWeights extends Schema.Schema.Type<typeof JointWeights> {}
export const JointSearchRequest = named(
  "JointSearchRequest",
  Schema.Struct({
    ...GraphSearchFields,
    query: defaultKey(Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1))), null),
    starts: defaultKey(Schema.Array(GraphStart).check(Schema.isMaxLength(32)), []),
    contextLimit: defaultKey(Limit, 50),
    seedLimit: defaultKey(PositiveInt.check(Schema.isLessThanOrEqualTo(32)), 8),
    traversalLimit: defaultKey(Limit, 500),
    weights: defaultKey(JointWeights, {}),
  }).check(
    Schema.makeFilter((value) =>
      (value.weights?.lexical ?? 0) > 0 && value.query == null
        ? "query is required when lexical weight is positive"
        : undefined,
    ),
  ),
)
export interface JointSearchRequest extends Schema.Schema.Type<typeof JointSearchRequest> {}

export const QueryExecuteRequest = named(
  "QueryExecuteRequest",
  Schema.Struct({ collection: CollectionRef, plan: QueryPlan }),
)
export interface QueryExecuteRequest extends Schema.Schema.Type<typeof QueryExecuteRequest> {}
export const QueryExplainRequest = named(
  "QueryExplainRequest",
  Schema.Struct({ collection: CollectionRef, textColumn: Identifier }),
)
export interface QueryExplainRequest extends Schema.Schema.Type<typeof QueryExplainRequest> {}

// Response models describe stable fields; ContextWire preserves additive wire fields at runtime.
export const ErrorBody = named(
  "ErrorBody",
  Schema.Struct({
    code: Schema.String,
    variant: Schema.OptionFromOptionalNullOr(Schema.String),
    message: Schema.String,
    details: JsonObject,
  }),
)
export interface ErrorBody extends Schema.Schema.Type<typeof ErrorBody> {}
export { ErrorBody as ContextErrorBody }
export const ErrorEnvelope = named("ErrorEnvelope", Schema.Struct({ requestId: Schema.String, error: ErrorBody }))
export interface ErrorEnvelope extends Schema.Schema.Type<typeof ErrorEnvelope> {}
export { ErrorEnvelope as ContextErrorEnvelope }

export const RuntimeCapabilities = named(
  "RuntimeCapabilities",
  Schema.Struct({
    postgresMajor: Schema.Int,
    pgcontextVersion: OptionalString,
    pgcontextSourceCommit: OptionalString,
    pgvectorInstalled: Schema.Boolean,
    pgcontextInstalled: Schema.Boolean,
    pgvectorVersion: Schema.OptionFromOptionalNullOr(Schema.String),
    pgvectorSchema: Schema.OptionFromOptionalNullOr(Schema.String),
    pgcontextPgvectorVersion: Schema.OptionFromOptionalNullOr(Schema.String),
    sameColumnBridge: defaultKey(Schema.Boolean, false),
  }),
)
export interface RuntimeCapabilities extends Schema.Schema.Type<typeof RuntimeCapabilities> {}
export const CompatibilityCapabilities = named(
  "CompatibilityCapabilities",
  Schema.Struct({
    targetVersion: Schema.Literal("0.2.0"),
    stableItems: Schema.Int,
    aligned: Schema.Int,
    managedEquivalent: Schema.Int,
    partial: Schema.Int,
    sqlOnly: Schema.Int,
    deferred: Schema.Int,
    missingSdk: Schema.Literal(0),
  }),
)
export interface CompatibilityCapabilities extends Schema.Schema.Type<typeof CompatibilityCapabilities> {}
export { CompatibilityCapabilities as PgContextCompatibilityCapabilities }

const capabilityFields = {
  setup: Schema.Boolean,
  setupBlocker: OptionalString,
  setupBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  denseSearch: Schema.Boolean,
  denseSearchBlocker: OptionalString,
  denseSearchBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  pointScroll: Schema.Boolean,
  pointScrollBlocker: OptionalString,
  pointScrollBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  count: Schema.Boolean,
  countBlocker: OptionalString,
  countBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  facets: Schema.Boolean,
  facetsBlocker: OptionalString,
  facetsBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  groupedSearch: Schema.Boolean,
  groupedSearchBlocker: OptionalString,
  groupedSearchBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  recallCheck: Schema.Boolean,
  recallCheckBlocker: OptionalString,
  recallCheckBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  textHybrid: Schema.Boolean,
  textHybridBlocker: OptionalString,
  textHybridBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  graphFirst: Schema.Boolean,
  graphFirstBlocker: OptionalString,
  graphFirstBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  vectorFirst: Schema.Boolean,
  vectorFirstBlocker: OptionalString,
  vectorFirstBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  rankFusion: Schema.Boolean,
  rankFusionBlocker: OptionalString,
  rankFusionBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
  joint: Schema.Boolean,
  jointBlocker: OptionalString,
  jointBlockerMessage: Schema.OptionFromOptionalNullOr(Schema.String),
}
export const CapabilitiesResponse = named(
  "CapabilitiesResponse",
  Schema.Struct({
    requestId: Schema.String,
    contractVersion: Schema.Literal("context.v1"),
    productStatus: Schema.Literal("preview"),
    pgcontextCompatibility: CompatibilityCapabilities,
    runtime: RuntimeCapabilities,
    ...capabilityFields,
    rankedSearchCursor: Schema.Literal(false),
    maxDimensions: Schema.Int,
    maxSearchLimit: Schema.Int,
    maxContextLimit: Schema.Int,
    maxGraphLimit: Schema.Int,
    maxJointSeedLimit: Schema.Int,
    maxJointTraversalLimit: Schema.Int,
    maxGraphDepth: Schema.Int,
    maxRelationshipTypes: Schema.Int,
    maxResultColumns: Schema.Int,
    maxFilterBytes: Schema.Int,
    maxFilterDepth: Schema.Int,
    maxFilterNodes: Schema.Int,
    maxFilterValues: Schema.Int,
    maxValuesPerMatch: Schema.Int,
    maxReconcilePointKeys: Schema.Int,
    maxPointKeysPerOperation: Schema.Int,
  }),
)
export interface CapabilitiesResponse extends Schema.Schema.Type<typeof CapabilitiesResponse> {}

export const DiscoveryReason = named(
  "DiscoveryReason",
  Schema.Struct({ code: Schema.String, message: Schema.String, field: Schema.OptionFromOptionalNullOr(Schema.String) }),
)
export interface DiscoveryReason extends Schema.Schema.Type<typeof DiscoveryReason> {}
export const DiscoverySource = named(
  "DiscoverySource",
  Schema.Struct({
    schemaName: Schema.String,
    tableName: Schema.String,
    sourceKeyColumn: Schema.String,
    sourceKeyType: Schema.String,
  }),
)
export interface DiscoverySource extends Schema.Schema.Type<typeof DiscoverySource> {}
export const DiscoveryVector = named(
  "DiscoveryVector",
  Schema.Struct({
    columnName: Schema.String,
    typeOwner: Schema.String,
    dimensions: OptionalInt,
    nullable: Schema.Boolean,
  }),
)
export interface DiscoveryVector extends Schema.Schema.Type<typeof DiscoveryVector> {}
export const DiscoveryColumn = named(
  "DiscoveryColumn",
  Schema.Struct({
    columnName: Schema.String,
    dataType: Schema.String,
    nullable: Schema.Boolean,
    ordinalPosition: Schema.Int,
  }),
)
export interface DiscoveryColumn extends Schema.Schema.Type<typeof DiscoveryColumn> {}
export const DiscoveryCandidate = named(
  "DiscoveryCandidate",
  Schema.Struct({
    classification: Schema.String,
    source: DiscoverySource,
    vectors: Schema.Array(DiscoveryVector),
    columns: defaultKey(Schema.Array(DiscoveryColumn), []),
    reasons: Schema.Array(DiscoveryReason),
  }),
)
export interface DiscoveryCandidate extends Schema.Schema.Type<typeof DiscoveryCandidate> {}
export const DiscoveryResponse = named(
  "DiscoveryResponse",
  Schema.Struct({ requestId: Schema.String, candidates: Schema.Array(DiscoveryCandidate) }),
)
export interface DiscoveryResponse extends Schema.Schema.Type<typeof DiscoveryResponse> {}

export const OnboardingCandidate = named(
  "OnboardingCandidate",
  Schema.Struct({
    vectorConfigurationId: Uuid,
    name: Schema.String,
    schemaName: Schema.String,
    tableName: Schema.String,
    rowIdColumn: Schema.String,
    embeddingColumn: Schema.String,
    dimensions: Schema.Int,
    metric: Metric,
    isDefault: Schema.Boolean,
  }),
)
export interface OnboardingCandidate extends Schema.Schema.Type<typeof OnboardingCandidate> {}
export { OnboardingCandidate as ContextOnboardingCandidate }
export const OnboardingResponse = named(
  "OnboardingResponse",
  Schema.Struct({
    requestId: Schema.String,
    status: Schema.String,
    compatibilityGeneration: Schema.Int,
    candidates: Schema.Array(OnboardingCandidate),
    offerAcknowledged: Schema.Boolean,
    selectedVectorConfigurationId: OptionalUuid,
    completedCollectionId: OptionalUuid,
    evaluatedAt: OptionalDateTime,
    updatedAt: OptionalDateTime,
  }),
)
export interface OnboardingResponse extends Schema.Schema.Type<typeof OnboardingResponse> {}
export { OnboardingResponse as ContextOnboardingResponse }

export const PreflightCheck = named(
  "PreflightCheck",
  Schema.Struct({ code: Schema.String, status: Schema.String, message: Schema.String }),
)
export interface PreflightCheck extends Schema.Schema.Type<typeof PreflightCheck> {}
export const PreflightBlocker = named(
  "PreflightBlocker",
  Schema.Struct({ code: Schema.String, message: Schema.String, field: Schema.OptionFromOptionalNullOr(Schema.String) }),
)
export interface PreflightBlocker extends Schema.Schema.Type<typeof PreflightBlocker> {}
export const PreflightOwnership = named(
  "PreflightOwnership",
  Schema.Struct({ sourceTable: Schema.String, vectorColumn: Schema.String, index: Schema.String }),
)
export interface PreflightOwnership extends Schema.Schema.Type<typeof PreflightOwnership> {}
export const PreflightResponse = named(
  "PreflightResponse",
  Schema.Struct({
    requestId: Schema.String,
    eligible: Schema.Boolean,
    classification: Schema.String,
    normalizedRequest: JsonObject,
    sourceIdentity: JsonObject,
    checks: Schema.Array(PreflightCheck),
    blockers: Schema.Array(PreflightBlocker),
    warnings: Schema.Array(JsonObject),
    plannedActions: Schema.Array(JsonObject),
    ownership: PreflightOwnership,
  }),
)
export interface PreflightResponse extends Schema.Schema.Type<typeof PreflightResponse> {}

export const CollectionVector = named(
  "CollectionVector",
  Schema.Struct({
    id: Uuid,
    name: Schema.String,
    columnName: Schema.String,
    isDefault: Schema.Boolean,
    ownsVectorColumn: Schema.Boolean,
    vectorTypeOwner: defaultKey(Schema.Literals(["pgcontext", "pgvector"]), "pgcontext"),
    dimensions: Schema.Int,
    metric: Metric,
    indexKind: IndexKind,
    indexName: OptionalString,
    ownsIndex: Schema.Boolean,
    indexStatus: Schema.String,
    lastErrorCode: OptionalString,
    lastErrorStage: OptionalString,
    createdAt: DateTime,
    updatedAt: DateTime,
  }),
)
export interface CollectionVector extends Schema.Schema.Type<typeof CollectionVector> {}
export { CollectionVector as ContextCollectionVector }
export const Collection = named(
  "Collection",
  Schema.Struct({
    id: Uuid,
    projectId: Schema.String,
    name: Schema.String,
    isDefault: Schema.Boolean,
    status: Schema.String,
    schemaName: Schema.String,
    tableName: Schema.String,
    sourceKeyColumn: Schema.String,
    sourceKeyType: Schema.String,
    sourceMode: SourceMode,
    ownsSourceTable: Schema.Boolean,
    defaultVectorName: Schema.String,
    vectors: Schema.Array(CollectionVector),
    maxSearchLimit: Schema.Int,
    textColumn: OptionalString,
    resultColumns: Schema.Array(Schema.String),
    filterColumns: Schema.Array(Schema.String),
    jsonbFilterPaths: Schema.Array(JsonObject),
    pointReconciliationStatus: Schema.String,
    mappedPointCount: OptionalInt,
    lastReconciledAt: OptionalDateTime,
    lastErrorCode: OptionalString,
    lastErrorStage: OptionalString,
    createdAt: DateTime,
    updatedAt: DateTime,
  }),
)
export interface Collection extends Schema.Schema.Type<typeof Collection> {}
export { Collection as ContextCollection }
export const CollectionListResponse = named(
  "CollectionListResponse",
  Schema.Struct({
    requestId: Schema.String,
    collections: Schema.Array(Collection),
    nextCursor: OptionalString,
    hasMore: Schema.Boolean,
  }),
)
export interface CollectionListResponse extends Schema.Schema.Type<typeof CollectionListResponse> {}
export const DeletionPlan = named(
  "DeletionPlan",
  Schema.Struct({
    pgcontextCollection: Schema.String,
    dropOwnedIndexes: Schema.Array(Schema.String),
    preserveSourceTable: Schema.String,
    preserveSourceColumns: Schema.Array(Schema.String),
    preserveIndexes: Schema.Array(Schema.String),
  }),
)
export interface DeletionPlan extends Schema.Schema.Type<typeof DeletionPlan> {}
export const CollectionGetResponse = named(
  "CollectionGetResponse",
  Schema.Struct({ requestId: Schema.String, collection: Collection, deletionPlan: DeletionPlan }),
)
export interface CollectionGetResponse extends Schema.Schema.Type<typeof CollectionGetResponse> {}

export const CollectionAlias = named(
  "CollectionAlias",
  Schema.Struct({ aliasName: Schema.String, collectionName: Schema.String }),
)
export interface CollectionAlias extends Schema.Schema.Type<typeof CollectionAlias> {}
export const CollectionAliasResponse = named(
  "CollectionAliasResponse",
  Schema.Struct({ requestId: Schema.String, alias: CollectionAlias }),
)
export interface CollectionAliasResponse extends Schema.Schema.Type<typeof CollectionAliasResponse> {}
export const CollectionAliasListResponse = named(
  "CollectionAliasListResponse",
  Schema.Struct({ requestId: Schema.String, aliases: Schema.Array(CollectionAlias) }),
)
export interface CollectionAliasListResponse extends Schema.Schema.Type<typeof CollectionAliasListResponse> {}
export const CollectionAliasDropResponse = named(
  "CollectionAliasDropResponse",
  Schema.Struct({ requestId: Schema.String, aliasName: Schema.String, dropped: Schema.Boolean }),
)
export interface CollectionAliasDropResponse extends Schema.Schema.Type<typeof CollectionAliasDropResponse> {}

export const PgContextCollectionInfo = named(
  "PgContextCollectionInfo",
  Schema.Struct({
    collectionId: PositiveInt,
    collectionName: Schema.String,
    ownerName: Schema.String,
    tableSchema: OptionalString,
    tableName: OptionalString,
  }),
)
export interface PgContextCollectionInfo extends Schema.Schema.Type<typeof PgContextCollectionInfo> {}
export const PgContextCollectionInfoResponse = named(
  "PgContextCollectionInfoResponse",
  Schema.Struct({ requestId: Schema.String, collection: PgContextCollectionInfo }),
)
export interface PgContextCollectionInfoResponse extends Schema.Schema.Type<typeof PgContextCollectionInfoResponse> {}
export const CollectionLimits = named(
  "CollectionLimits",
  Schema.Struct({
    strictMode: Schema.Boolean,
    maxDimensions: OptionalInt,
    maxVectors: OptionalInt,
    maxPoints: OptionalInt,
    maxFilterNodes: OptionalInt,
    maxSearchLimit: OptionalInt,
    maxCandidateBudget: OptionalInt,
    queryTimeoutMs: OptionalInt,
    maxIndexMemoryBytes: OptionalInt,
  }),
)
export interface CollectionLimits extends Schema.Schema.Type<typeof CollectionLimits> {}
export const CollectionLimitsResponse = named(
  "CollectionLimitsResponse",
  Schema.Struct({ requestId: Schema.String, collectionName: Schema.String, limits: CollectionLimits }),
)
export interface CollectionLimitsResponse extends Schema.Schema.Type<typeof CollectionLimitsResponse> {}
export const VectorMetadata = named(
  "VectorMetadata",
  Schema.Struct({
    collectionName: Schema.String,
    vectorName: Schema.String,
    tableSchema: Schema.String,
    tableName: Schema.String,
    vectorColumn: Schema.String,
    dimensions: Dimensions,
    metric: Schema.String,
    hnswOptions: JsonObject,
    quantizationOptions: JsonObject,
    status: Schema.String,
  }),
)
export interface VectorMetadata extends Schema.Schema.Type<typeof VectorMetadata> {}
export { VectorMetadata as PgContextVectorMetadata }
export const CollectionVectorsResponse = named(
  "CollectionVectorsResponse",
  Schema.Struct({ requestId: Schema.String, collectionName: Schema.String, vectors: Schema.Array(VectorMetadata) }),
)
export interface CollectionVectorsResponse extends Schema.Schema.Type<typeof CollectionVectorsResponse> {}
export const VectorConfigureResponse = named(
  "VectorConfigureResponse",
  Schema.Struct({ requestId: Schema.String, vector: VectorMetadata }),
)
export interface VectorConfigureResponse extends Schema.Schema.Type<typeof VectorConfigureResponse> {}

export const OperationFailure = named(
  "OperationFailure",
  Schema.Struct({
    code: Schema.String,
    variant: Schema.OptionFromOptionalNullOr(Schema.String),
    message: Schema.String,
    details: JsonObject,
    httpStatus: Schema.Int,
  }),
)
export interface OperationFailure extends Schema.Schema.Type<typeof OperationFailure> {}
export { OperationFailure as ContextOperationFailure }
export const Operation = named(
  "Operation",
  Schema.Struct({
    id: Uuid,
    collectionId: OptionalUuid,
    kind: OperationKind,
    status: Schema.String,
    stage: Schema.String,
    processedUnits: Schema.Int,
    totalUnits: OptionalInt,
    attempts: Schema.Int,
    retryUntil: DateTime,
    error: Schema.OptionFromNullOr(OperationFailure),
    createdAt: DateTime,
    startedAt: OptionalDateTime,
    finishedAt: OptionalDateTime,
    updatedAt: DateTime,
  }),
)
export interface Operation extends Schema.Schema.Type<typeof Operation> {}
export { Operation as ContextOperation }
export const OperationEnvelope = named(
  "OperationEnvelope",
  Schema.Struct({ requestId: Schema.String, operation: Operation }),
)
export interface OperationEnvelope extends Schema.Schema.Type<typeof OperationEnvelope> {}
export const OperationListResponse = named(
  "OperationListResponse",
  Schema.Struct({
    requestId: Schema.String,
    operations: Schema.Array(Operation),
    nextCursor: OptionalString,
    hasMore: Schema.Boolean,
  }),
)
export interface OperationListResponse extends Schema.Schema.Type<typeof OperationListResponse> {}

export const CollectionStatusResponse = named(
  "CollectionStatusResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    collectionName: Schema.String,
    status: Schema.String,
    servingStatus: Schema.String,
    vectors: Schema.Array(CollectionVector),
    pointReconciliationStatus: Schema.String,
    mappedPointCount: OptionalInt,
    lastReconciledAt: OptionalDateTime,
    activeOperation: Schema.OptionFromNullOr(Operation),
    lastErrorCode: OptionalString,
    lastErrorStage: OptionalString,
    updatedAt: DateTime,
  }),
)
export interface CollectionStatusResponse extends Schema.Schema.Type<typeof CollectionStatusResponse> {}
export const VerificationCheck = named(
  "VerificationCheck",
  Schema.Struct({ name: Schema.String, status: Schema.String, code: OptionalString, message: Schema.String }),
)
export interface VerificationCheck extends Schema.Schema.Type<typeof VerificationCheck> {}
export const VerificationResponse = named(
  "VerificationResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    collectionName: Schema.String,
    verified: Schema.Boolean,
    checkedAt: DateTime,
    checks: Schema.Array(VerificationCheck),
  }),
)
export interface VerificationResponse extends Schema.Schema.Type<typeof VerificationResponse> {}
export const DiagnosticCheck = named(
  "DiagnosticCheck",
  Schema.Struct({
    name: Schema.String,
    status: Schema.String,
    code: OptionalString,
    message: Schema.String,
    expected: OptionalString,
    actual: OptionalString,
    count: OptionalInt,
  }),
)
export interface DiagnosticCheck extends Schema.Schema.Type<typeof DiagnosticCheck> {}
export const RecommendedAction = named(
  "RecommendedAction",
  Schema.Struct({ action: Schema.String, message: Schema.String }),
)
export interface RecommendedAction extends Schema.Schema.Type<typeof RecommendedAction> {}
export const DiagnosticsResponse = named(
  "DiagnosticsResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    collectionName: Schema.String,
    overallStatus: Schema.String,
    checkedAt: DateTime,
    checks: Schema.Array(DiagnosticCheck),
    recommendedActions: Schema.Array(RecommendedAction),
  }),
)
export interface DiagnosticsResponse extends Schema.Schema.Type<typeof DiagnosticsResponse> {}
export const FilterRegistration = named(
  "FilterRegistration",
  Schema.Struct({
    key: Schema.String,
    kind: FilterKind,
    column: Schema.String,
    path: Schema.OptionFromNullOr(Schema.Array(Schema.String)),
  }),
)
export interface FilterRegistration extends Schema.Schema.Type<typeof FilterRegistration> {}
export const FilterListResponse = named(
  "FilterListResponse",
  Schema.Struct({ requestId: Schema.String, collectionId: Uuid, filters: Schema.Array(FilterRegistration) }),
)
export interface FilterListResponse extends Schema.Schema.Type<typeof FilterListResponse> {}

export const PointStatusResponse = named(
  "PointStatusResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    status: Schema.String,
    mappedPointCount: OptionalInt,
    lastReconciledAt: OptionalDateTime,
    lastErrorCode: OptionalString,
    lastErrorStage: OptionalString,
    activeOperation: Schema.OptionFromNullOr(Operation),
  }),
)
export interface PointStatusResponse extends Schema.Schema.Type<typeof PointStatusResponse> {}
export const PointMapping = named("PointMapping", Schema.Struct({ pointId: Schema.Int, sourceKey: Schema.String }))
export interface PointMapping extends Schema.Schema.Type<typeof PointMapping> {}
export const PointScrollResponse = named(
  "PointScrollResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    points: Schema.Array(PointMapping),
    nextCursor: OptionalString,
    hasMore: Schema.Boolean,
  }),
)
export interface PointScrollResponse extends Schema.Schema.Type<typeof PointScrollResponse> {}
export const PointMutationResponse = named(
  "PointMutationResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    processed: Schema.Int,
    inserted: Schema.Int,
    reactivated: Schema.Int,
    alreadyActive: Schema.Int,
    deleted: Schema.Int,
    alreadyAbsent: Schema.Int,
  }),
)
export interface PointMutationResponse extends Schema.Schema.Type<typeof PointMutationResponse> {}
export const PointBatchProgress = named(
  "PointBatchProgress",
  Schema.Struct({
    batchNumber: Schema.Int,
    processedCount: Schema.Int,
    insertedCount: Schema.OptionFromOptionalNullOr(Schema.Int),
    reactivatedCount: Schema.OptionFromOptionalNullOr(Schema.Int),
    deletedCount: Schema.OptionFromOptionalNullOr(Schema.Int),
    missingCount: Schema.OptionFromOptionalNullOr(Schema.Int),
  }),
)
export interface PointBatchProgress extends Schema.Schema.Type<typeof PointBatchProgress> {}
export const PointBatchResponse = named(
  "PointBatchResponse",
  Schema.Struct({ requestId: Schema.String, batches: Schema.Array(PointBatchProgress) }),
)
export interface PointBatchResponse extends Schema.Schema.Type<typeof PointBatchResponse> {}
export const PayloadMutationResult = named(
  "PayloadMutationResult",
  Schema.Struct({ sourceKey: Schema.String, updated: Schema.Boolean }),
)
export interface PayloadMutationResult extends Schema.Schema.Type<typeof PayloadMutationResult> {}
export const PayloadMutationResponse = named(
  "PayloadMutationResponse",
  Schema.Struct({ requestId: Schema.String, results: Schema.Array(PayloadMutationResult) }),
)
export interface PayloadMutationResponse extends Schema.Schema.Type<typeof PayloadMutationResponse> {}
export const ScoredPoint = named(
  "ScoredPoint",
  Schema.Struct({ pointId: Schema.Int, sourceKey: Schema.String, score: Schema.Finite }),
)
export interface ScoredPoint extends Schema.Schema.Type<typeof ScoredPoint> {}
export { ScoredPoint as PgContextScoredPoint }
export const ScoredResponse = named(
  "ScoredResponse",
  Schema.Struct({ requestId: Schema.String, results: Schema.Array(ScoredPoint) }),
)
export interface ScoredResponse extends Schema.Schema.Type<typeof ScoredResponse> {}
export { ScoredResponse as PgContextScoredResponse }

const rowsResponse = <S extends Schema.Top>(identifier: string, row: S) =>
  named(identifier, Schema.Struct({ requestId: Schema.String, rows: Schema.Array(row) }))
export const IndexStatusRow = named(
  "IndexStatusRow",
  Schema.Struct({
    indexSchema: Schema.String,
    indexName: Schema.String,
    tableSchema: Schema.String,
    tableName: Schema.String,
    accessMethod: Schema.String,
    isValid: Schema.Boolean,
    isReady: Schema.Boolean,
    isLive: Schema.Boolean,
    status: Schema.String,
  }),
)
export interface IndexStatusRow extends Schema.Schema.Type<typeof IndexStatusRow> {}
export const IndexDiagnosticsRow = named(
  "IndexDiagnosticsRow",
  Schema.Struct({
    indexSchema: Schema.String,
    indexName: Schema.String,
    tableSchema: Schema.String,
    tableName: Schema.String,
    accessMethod: Schema.String,
    status: Schema.String,
    contextError: OptionalString,
    sqlstate: OptionalString,
    repairAdvice: Schema.String,
  }),
)
export interface IndexDiagnosticsRow extends Schema.Schema.Type<typeof IndexDiagnosticsRow> {}
export const IndexMemoryEstimateRow = named(
  "IndexMemoryEstimateRow",
  Schema.Struct({
    indexSchema: Schema.String,
    indexName: Schema.String,
    tableSchema: Schema.String,
    tableName: Schema.String,
    accessMethod: Schema.String,
    estimatedRows: Schema.Int,
    dimensions: Schema.Int,
    vectorBytes: Schema.Int,
    linkBytes: Schema.Int,
    totalBytes: Schema.Int,
    status: Schema.String,
  }),
)
export interface IndexMemoryEstimateRow extends Schema.Schema.Type<typeof IndexMemoryEstimateRow> {}
export const IndexAdvisorRow = named(
  "IndexAdvisorRow",
  Schema.Struct({
    collectionName: Schema.String,
    filterKey: OptionalString,
    columnName: OptionalString,
    recommendation: Schema.String,
    detail: Schema.String,
    suggestedSql: OptionalString,
  }),
)
export interface IndexAdvisorRow extends Schema.Schema.Type<typeof IndexAdvisorRow> {}
export const OptimizationStatusRow = named(
  "OptimizationStatusRow",
  Schema.Struct({
    collectionName: Schema.String,
    tableSchema: OptionalString,
    tableName: OptionalString,
    hasSourceTable: Schema.Boolean,
    sourceTableExists: Schema.Boolean,
    registeredVectors: Schema.Int,
    activePoints: Schema.Int,
    filterFields: Schema.Int,
    hnswIndexes: Schema.Int,
    status: Schema.String,
  }),
)
export interface OptimizationStatusRow extends Schema.Schema.Type<typeof OptimizationStatusRow> {}
export const VacuumAdviceRow = named(
  "VacuumAdviceRow",
  Schema.Struct({
    indexSchema: Schema.String,
    indexName: Schema.String,
    tableSchema: Schema.String,
    tableName: Schema.String,
    accessMethod: Schema.String,
    estimatedIndexTuples: Schema.Int,
    indexPages: Schema.Int,
    deadTableTuples: Schema.Int,
    status: Schema.String,
  }),
)
export interface VacuumAdviceRow extends Schema.Schema.Type<typeof VacuumAdviceRow> {}
export const TelemetryRow = named(
  "TelemetryRow",
  Schema.Struct({
    collectionName: Schema.String,
    tableSchema: OptionalString,
    tableName: OptionalString,
    hasSourceTable: Schema.Boolean,
    sourceTableExists: Schema.Boolean,
    registeredVectors: Schema.Int,
    activePoints: Schema.Int,
    deletedPoints: Schema.Int,
    filterFields: Schema.Int,
    hnswIndexes: Schema.Int,
    status: Schema.String,
  }),
)
export interface TelemetryRow extends Schema.Schema.Type<typeof TelemetryRow> {}
export const ModelVersionRow = named(
  "ModelVersionRow",
  Schema.Struct({
    collectionName: Schema.String,
    modelName: Schema.String,
    modelVersion: Schema.String,
    dimensions: Schema.Int,
    metric: Schema.String,
    isActive: Schema.Boolean,
  }),
)
export interface ModelVersionRow extends Schema.Schema.Type<typeof ModelVersionRow> {}
export const EmbeddingMigrationRow = named(
  "EmbeddingMigrationRow",
  Schema.Struct({
    migrationId: Schema.Int,
    collectionName: Schema.String,
    sourceModel: Schema.String,
    sourceVersion: Schema.String,
    targetModel: Schema.String,
    targetVersion: Schema.String,
    status: Schema.String,
    totalPoints: Schema.Int,
    processedPoints: Schema.Int,
  }),
)
export interface EmbeddingMigrationRow extends Schema.Schema.Type<typeof EmbeddingMigrationRow> {}
export const QueryCohortStatsRow = named(
  "QueryCohortStatsRow",
  Schema.Struct({
    collectionName: Schema.String,
    cohort: Schema.String,
    queryKind: Schema.String,
    queryCount: Schema.Int,
    totalResults: Schema.Int,
    totalCandidates: OptionalInt,
    totalRowsRechecked: Schema.Int,
    totalRowsPruned: Schema.Int,
    avgRecallThreshold: OptionalFinite,
    avgRecallAchieved: OptionalFinite,
    latencyBucket: Schema.String,
    lifecycleState: Schema.String,
    avgLatencyMs: Schema.Finite,
    status: Schema.String,
  }),
)
export interface QueryCohortStatsRow extends Schema.Schema.Type<typeof QueryCohortStatsRow> {}
export const QueryExecutionStatsRow = named(
  "QueryExecutionStatsRow",
  Schema.Struct({
    collectionName: Schema.String,
    queryKind: Schema.String,
    strategy: Schema.String,
    queryCount: Schema.Int,
    totalVisits: Schema.Int,
    totalFilterCandidates: Schema.Int,
    totalCandidates: Schema.Int,
    totalRechecks: Schema.Int,
    totalStages: Schema.Int,
    totalExpansions: Schema.Int,
    completion: Schema.String,
    latencyBucket: Schema.String,
    lifecycleState: Schema.String,
    avgLatencyMs: Schema.Finite,
  }),
)
export interface QueryExecutionStatsRow extends Schema.Schema.Type<typeof QueryExecutionStatsRow> {}

export const IndexStatusResponse = rowsResponse("IndexStatusResponse", IndexStatusRow)
export interface IndexStatusResponse extends Schema.Schema.Type<typeof IndexStatusResponse> {}
export const IndexDiagnosticsResponse = rowsResponse("IndexDiagnosticsResponse", IndexDiagnosticsRow)
export interface IndexDiagnosticsResponse extends Schema.Schema.Type<typeof IndexDiagnosticsResponse> {}
export const IndexMemoryEstimateResponse = rowsResponse("IndexMemoryEstimateResponse", IndexMemoryEstimateRow)
export interface IndexMemoryEstimateResponse extends Schema.Schema.Type<typeof IndexMemoryEstimateResponse> {}
export const IndexAdvisorResponse = rowsResponse("IndexAdvisorResponse", IndexAdvisorRow)
export interface IndexAdvisorResponse extends Schema.Schema.Type<typeof IndexAdvisorResponse> {}
export const OptimizationStatusResponse = rowsResponse("OptimizationStatusResponse", OptimizationStatusRow)
export interface OptimizationStatusResponse extends Schema.Schema.Type<typeof OptimizationStatusResponse> {}
export const VacuumAdviceResponse = rowsResponse("VacuumAdviceResponse", VacuumAdviceRow)
export interface VacuumAdviceResponse extends Schema.Schema.Type<typeof VacuumAdviceResponse> {}
export const TelemetryResponse = rowsResponse("TelemetryResponse", TelemetryRow)
export interface TelemetryResponse extends Schema.Schema.Type<typeof TelemetryResponse> {}
export const ModelVersionsResponse = rowsResponse("ModelVersionsResponse", ModelVersionRow)
export interface ModelVersionsResponse extends Schema.Schema.Type<typeof ModelVersionsResponse> {}
export const EmbeddingMigrationsResponse = rowsResponse("EmbeddingMigrationsResponse", EmbeddingMigrationRow)
export interface EmbeddingMigrationsResponse extends Schema.Schema.Type<typeof EmbeddingMigrationsResponse> {}
export const QueryCohortStatsResponse = rowsResponse("QueryCohortStatsResponse", QueryCohortStatsRow)
export interface QueryCohortStatsResponse extends Schema.Schema.Type<typeof QueryCohortStatsResponse> {}
export const QueryExecutionStatsResponse = rowsResponse("QueryExecutionStatsResponse", QueryExecutionStatsRow)
export interface QueryExecutionStatsResponse extends Schema.Schema.Type<typeof QueryExecutionStatsResponse> {}

export const RawVectorSearchResult = named(
  "RawVectorSearchResult",
  Schema.Struct({ pointId: Schema.Int, score: Schema.Finite }),
)
export interface RawVectorSearchResult extends Schema.Schema.Type<typeof RawVectorSearchResult> {}
export const RawVectorSearchResponse = named(
  "RawVectorSearchResponse",
  Schema.Struct({ requestId: Schema.String, results: Schema.Array(RawVectorSearchResult) }),
)
export interface RawVectorSearchResponse extends Schema.Schema.Type<typeof RawVectorSearchResponse> {}
export const CountResponse = named(
  "CountResponse",
  Schema.Struct({ requestId: Schema.String, collectionId: Uuid, collectionName: Schema.String, count: Schema.Int }),
)
export interface CountResponse extends Schema.Schema.Type<typeof CountResponse> {}
export const FacetValue = named("FacetValue", Schema.Struct({ value: Schema.String, count: Schema.Int }))
export interface FacetValue extends Schema.Schema.Type<typeof FacetValue> {}
export const FacetsResponse = named(
  "FacetsResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    collectionName: Schema.String,
    field: Schema.String,
    facets: Schema.Array(FacetValue),
  }),
)
export interface FacetsResponse extends Schema.Schema.Type<typeof FacetsResponse> {}

export const SourceIdentity = named(
  "SourceIdentity",
  Schema.Struct({ schema: Schema.String, table: Schema.String, id: Schema.String }),
)
export interface SourceIdentity extends Schema.Schema.Type<typeof SourceIdentity> {}
export { SourceIdentity as ContextSourceIdentity }
export const ContextLane = named(
  "ContextLane",
  Schema.Struct({ rank: PositiveInt, score: Schema.Finite, metric: Metric }),
)
export interface ContextLane extends Schema.Schema.Type<typeof ContextLane> {}
export const Relationship = named(
  "Relationship",
  Schema.Struct({ type: Schema.String, direction: Schema.String, from: SourceIdentity, to: SourceIdentity }),
)
export interface Relationship extends Schema.Schema.Type<typeof Relationship> {}
export const GraphLane = named(
  "GraphLane",
  Schema.Struct({ rank: OptionalInt, depth: OptionalInt, relationships: Schema.Array(Relationship) }),
)
export interface GraphLane extends Schema.Schema.Type<typeof GraphLane> {}
export const FusionMetadata = named(
  "FusionMetadata",
  Schema.Struct({
    method: Schema.Literal("weighted_rrf"),
    k: Schema.Literal(60),
    contextWeight: Schema.Finite,
    graphWeight: Schema.Finite,
  }),
)
export interface FusionMetadata extends Schema.Schema.Type<typeof FusionMetadata> {}
export const LexicalLane = named("LexicalLane", Schema.Struct({ rank: PositiveInt, score: Schema.Finite }))
export interface LexicalLane extends Schema.Schema.Type<typeof LexicalLane> {}
export const JointGraphLane = named(
  "JointGraphLane",
  Schema.Struct({
    rank: PositiveInt,
    depth: PositiveInt.check(Schema.isLessThanOrEqualTo(20)),
    relationships: Schema.Array(Relationship),
  }),
)
export interface JointGraphLane extends Schema.Schema.Type<typeof JointGraphLane> {}
const isClose = (left: number, right: number, relativeTolerance: number, absoluteTolerance: number) =>
  Math.abs(left - right) <= Math.max(relativeTolerance * Math.max(Math.abs(left), Math.abs(right)), absoluteTolerance)
export const JointScoreBreakdown = named(
  "JointScoreBreakdown",
  Schema.Struct({
    semantic: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    lexical: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    graph: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    total: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  }).check(
    Schema.makeFilter((value) => {
      const contributions = value.semantic + value.lexical + value.graph
      return isClose(value.total, contributions, 1e-9, 1e-12) ? undefined : "total must equal lane contributions"
    }),
  ),
)
export interface JointScoreBreakdown extends Schema.Schema.Type<typeof JointScoreBreakdown> {}
export const JointFusionWeights = named(
  "JointFusionWeights",
  Schema.Struct({
    semantic: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    lexical: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    graph: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  }).check(
    Schema.makeFilter((value) =>
      isClose(value.semantic + value.lexical + value.graph, 1, 1e-9, 1e-9)
        ? undefined
        : "fusion weights must be normalized",
    ),
  ),
)
export interface JointFusionWeights extends Schema.Schema.Type<typeof JointFusionWeights> {}
export const JointFusionMetadata = named(
  "JointFusionMetadata",
  Schema.Struct({ method: Schema.Literal("joint_weighted_rrf"), k: Schema.Literal(60), weights: JointFusionWeights }),
)
export interface JointFusionMetadata extends Schema.Schema.Type<typeof JointFusionMetadata> {}
export const JointTrace = named(
  "JointTrace",
  Schema.Struct({
    semanticCandidates: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000)),
    lexicalCandidates: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000)),
    explicitSeeds: NonNegativeInt.check(Schema.isLessThanOrEqualTo(32)),
    retrievalSeeds: NonNegativeInt.check(Schema.isLessThanOrEqualTo(32)),
    retainedSeeds: NonNegativeInt.check(Schema.isLessThanOrEqualTo(32)),
    graphCandidates: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000)),
    combinedCandidates: NonNegativeInt.check(Schema.isLessThanOrEqualTo(3_000)),
    rescoredCandidates: NonNegativeInt.check(Schema.isLessThanOrEqualTo(3_000)),
  }),
)
export interface JointTrace extends Schema.Schema.Type<typeof JointTrace> {}
export const Warning = named(
  "Warning",
  Schema.Struct({ code: Schema.String, message: Schema.String, details: JsonObject }),
)
export interface Warning extends Schema.Schema.Type<typeof Warning> {}
export { Warning as ContextWarning }
export const RankedCollection = named("RankedCollection", Schema.Struct({ id: Uuid, name: Schema.String }))
export interface RankedCollection extends Schema.Schema.Type<typeof RankedCollection> {}

const SearchResultFields = {
  pointId: Schema.Int,
  source: SourceIdentity,
  rank: Schema.Int,
  score: Schema.Finite,
  scoreKind: Schema.String,
  metric: Schema.OptionFromOptionalNullOr(Metric),
  properties: JsonObject,
  groupValue: Schema.OptionFromOptionalNullOr(Schema.String),
  groupRank: Schema.OptionFromOptionalNullOr(Schema.Int),
}
export const SearchResult = named("SearchResult", Schema.Struct(SearchResultFields))
export interface SearchResult extends Schema.Schema.Type<typeof SearchResult> {}
export { SearchResult as ContextSearchResult }
export const TextHybridResult = named(
  "TextHybridResult",
  Schema.Struct({ ...SearchResultFields, scoreKind: Schema.Literal("rrf"), rrfK: Schema.Literal(60) }),
)
export interface TextHybridResult extends Schema.Schema.Type<typeof TextHybridResult> {}
export { TextHybridResult as ContextTextHybridResult }
export const GraphHybridResult = named(
  "GraphHybridResult",
  Schema.Struct({
    ...SearchResultFields,
    mode: Schema.Literals(["graph_first", "vector_first", "rank_fusion"]),
    context: Schema.OptionFromNullOr(ContextLane),
    graph: Schema.OptionFromNullOr(GraphLane),
    fusion: Schema.OptionFromNullOr(FusionMetadata),
  }),
)
export interface GraphHybridResult extends Schema.Schema.Type<typeof GraphHybridResult> {}
export { GraphHybridResult as ContextGraphHybridResult }
export const RankedResponse = named(
  "RankedResponse",
  Schema.Struct({
    requestId: Schema.String,
    collection: RankedCollection,
    mode: Schema.String,
    results: Schema.Array(Schema.Union([TextHybridResult, GraphHybridResult, SearchResult])),
    warnings: Schema.Array(Warning),
  }),
)
export interface RankedResponse extends Schema.Schema.Type<typeof RankedResponse> {}

export const JointResult = named(
  "JointResult",
  Schema.Struct({
    ...SearchResultFields,
    scoreKind: Schema.Literal("joint_weighted_rrf"),
    metric: Schema.OptionFromNullOr(Schema.Never),
    introducedByGraph: Schema.Boolean,
    baselineRank: Schema.OptionFromNullOr(PositiveInt),
    rankLift: OptionalInt,
    context: ContextLane,
    lexical: Schema.OptionFromNullOr(LexicalLane),
    graph: Schema.OptionFromNullOr(JointGraphLane),
    scoreBreakdown: JointScoreBreakdown,
  }).check(
    Schema.makeFilter((value) => {
      const baseline = Option.isSome(value.baselineRank)
      const lift = Option.isSome(value.rankLift)
      const graph = Option.isSome(value.graph)
      if (value.introducedByGraph && (baseline || lift || !graph))
        return "graph-introduced result has inconsistent provenance"
      if (!value.introducedByGraph && (!baseline || !lift)) return "baseline result requires rank provenance"
      return isClose(value.score, value.scoreBreakdown.total, 1e-9, 1e-12)
        ? undefined
        : "score must equal contribution total"
    }),
  ),
)
export interface JointResult extends Schema.Schema.Type<typeof JointResult> {}
export { JointResult as ContextJointResult }
export const JointResponse = named(
  "JointResponse",
  Schema.Struct({
    requestId: Schema.String,
    collection: RankedCollection,
    mode: Schema.Literal("joint"),
    results: Schema.Array(JointResult),
    fusion: JointFusionMetadata,
    trace: JointTrace,
    warnings: Schema.Array(Warning),
  }),
)
export interface JointResponse extends Schema.Schema.Type<typeof JointResponse> {}
export { JointResponse as ContextJointResponse }

export const QueryExecutionResult = named(
  "QueryExecutionResult",
  Schema.Struct({ pointId: PositiveInt, sourceKey: Schema.String, score: Schema.Finite }),
)
export interface QueryExecutionResult extends Schema.Schema.Type<typeof QueryExecutionResult> {}
export const QueryExecutionResponse = named(
  "QueryExecutionResponse",
  Schema.Struct({
    requestId: Schema.String,
    collection: RankedCollection,
    results: Schema.Array(QueryExecutionResult),
  }),
)
export interface QueryExecutionResponse extends Schema.Schema.Type<typeof QueryExecutionResponse> {}
export const QueryExplainRow = named(
  "QueryExplainRow",
  Schema.Struct({
    stage: Schema.String,
    detail: Schema.String,
    branch: OptionalString,
    strategy: Schema.String,
    status: Schema.String,
    estimatedCandidates: OptionalInt,
    candidateBudget: OptionalInt,
  }),
)
export interface QueryExplainRow extends Schema.Schema.Type<typeof QueryExplainRow> {}
export const QueryExplainResponse = named(
  "QueryExplainResponse",
  Schema.Struct({ requestId: Schema.String, collection: RankedCollection, rows: Schema.Array(QueryExplainRow) }),
)
export interface QueryExplainResponse extends Schema.Schema.Type<typeof QueryExplainResponse> {}
export const RecallCheckResponse = named(
  "RecallCheckResponse",
  Schema.Struct({
    requestId: Schema.String,
    collectionId: Uuid,
    collectionName: Schema.String,
    exactCount: Schema.Int,
    candidateCount: Schema.Int,
    intersectionCount: Schema.Int,
    recall: Schema.Finite,
    minimumRecall: Schema.Finite,
    status: Schema.String,
  }),
)
export interface RecallCheckResponse extends Schema.Schema.Type<typeof RecallCheckResponse> {}
