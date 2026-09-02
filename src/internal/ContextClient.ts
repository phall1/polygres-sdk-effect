import { Clock, DateTime, Duration, Effect, Option, Schema } from "effect"

import * as Context from "../Context.js"
import * as ContextQuery from "../ContextQuery.js"
import type { JsonObject } from "../Entity.js"
import type * as Operation from "../Operation.js"
import * as Page from "../Page.js"
import * as PolygresError from "../PolygresError.js"
import { type ContextOperationBinding, contextBindings } from "./ContextBindings.js"
import * as ContextWire from "./ContextWire.js"
import type * as HttpTransport from "./HttpTransport.js"
import * as OperationWait from "./OperationWait.js"

type RequestError = PolygresError.Request | PolygresError.InvalidInput
type Call<Input, Output> = (input: Input) => Effect.Effect<Output, RequestError>
type Controls = { readonly timeout?: Duration.Input }
type Idempotent = Controls & { readonly idempotencyKey?: Context.IdempotencyKey }
type WithDefaults<A, K extends keyof A> = Omit<A, K> & Partial<Pick<A, K>>
type WithUnionDefaults<A, K extends PropertyKey> = A extends unknown
  ? Omit<A, Extract<keyof A, K>> & Partial<Pick<A, Extract<keyof A, K>>>
  : never
type Response<A> = A & { readonly metadata: JsonObject }

type EmptyInput = Controls
type EmptyMutationInput = Idempotent
type CollectionIdInput = Controls & { readonly collectionId: Context.Uuid }
type CollectionIdMutationInput = Idempotent & { readonly collectionId: Context.Uuid }
type OperationIdInput = Controls & { readonly operationId: Context.Uuid }
type OperationIdMutationInput = Idempotent & { readonly operationId: Context.Uuid }
type CollectionNameInput = Controls & { readonly collectionName: Context.Identifier }
type IndexInput = CollectionNameInput & { readonly indexName: Context.Identifier }

export type ListCollectionsInput = Controls & {
  readonly status?: Context.CollectionStatus
  readonly limit?: Context.AdminPageLimit
  readonly cursor?: string
}
export type ListOperationsInput = Controls & {
  readonly collectionId?: Context.Uuid
  readonly kind?: Context.OperationKind
  readonly status?: Context.OperationStatus
  readonly limit?: Context.AdminPageLimit
  readonly cursor?: string
}
export type ScrollInput = CollectionIdInput & { readonly limit?: Context.PointPageLimit; readonly cursor?: string }

type CreateCollectionInput = WithDefaults<
  Context.CollectionCreateRequest,
  "filterColumns" | "indexKind" | "jsonbFilterPaths" | "maxSearchLimit" | "resultColumns" | "textColumn"
> &
  Idempotent
type PreflightInput = Omit<CreateCollectionInput, "idempotencyKey">
type VectorMutationInput = Idempotent & {
  readonly collectionId: Context.Uuid
  readonly columnName: Context.Identifier
  readonly dimensions: number
} & Partial<Omit<Context.VectorCreateRequest, "columnName" | "dimensions">>
type CollectionUpdateInput = Context.CollectionUpdateRequest & CollectionIdMutationInput
type CollectionDeleteInput = Context.CollectionDeleteRequest & CollectionIdMutationInput
type FilterColumnInput = Context.FilterColumnRequest & CollectionIdMutationInput
type FilterJsonbInput = Context.FilterJsonbPathRequest & CollectionIdMutationInput
type PointMutationInput = Context.PointKeysRequest & CollectionIdMutationInput
type CollectionNamedBody<A> = Omit<A, "collection"> & CollectionNameInput

export interface WaitForOperationInput extends OperationWait.Options {
  readonly operationId: Context.Uuid
}

export interface ContextService {
  readonly acknowledgeOnboarding: Call<EmptyMutationInput, Response<Context.OnboardingResponse>>
  readonly addFilterColumn: Call<FilterColumnInput, Operation.Value>
  readonly addJsonbFilterPath: Call<FilterJsonbInput, Operation.Value>
  readonly addVector: Call<VectorMutationInput, Operation.Value>
  readonly backfillPoints: Call<
    WithDefaults<Context.BackfillPointsRequest, "batchSize"> & Controls,
    Response<Context.PointBatchResponse>
  >
  readonly bulkDeletePoints: Call<
    WithDefaults<Context.BulkPointKeysRequest, "batchSize"> & Controls,
    Response<Context.PointBatchResponse>
  >
  readonly bulkUpsertPoints: Call<
    WithDefaults<Context.BulkPointKeysRequest, "batchSize"> & Controls,
    Response<Context.PointBatchResponse>
  >
  readonly cancelOperation: Call<OperationIdMutationInput, Operation.Value>
  readonly candidateSearch: Call<
    WithDefaults<Context.CandidateSearchRequest, "filter" | "limit" | "vectorName"> & Controls,
    Response<Context.ScoredResponse>
  >
  readonly clearPayload: Call<Context.ClearPayloadRequest & Controls, Response<Context.PayloadMutationResponse>>
  readonly collectionAliases: Call<EmptyInput, Response<Context.CollectionAliasListResponse>>
  readonly collectionInfo: Call<CollectionNameInput, Response<Context.PgContextCollectionInfoResponse>>
  readonly collectionLimits: Call<CollectionNameInput, Response<Context.CollectionLimitsResponse>>
  readonly collectionVectors: Call<CollectionNameInput, Response<Context.CollectionVectorsResponse>>
  readonly configureCollectionLimits: Call<
    Context.CollectionLimitsRequest & CollectionNameInput,
    Response<Context.CollectionLimitsResponse>
  >
  readonly configureVector: Call<
    Context.VectorConfigureRequest & CollectionNameInput & { readonly vectorName: Context.Identifier },
    Response<Context.VectorConfigureResponse>
  >
  readonly count: Call<WithDefaults<Context.CountRequest, "filter"> & Controls, Response<Context.CountResponse>>
  readonly createCollection: Call<CreateCollectionInput, Operation.Value>
  readonly createCollectionAlias: Call<
    Context.CollectionAliasRequest & Controls,
    Response<Context.CollectionAliasResponse>
  >
  readonly createEmbeddingMigration: Call<
    CollectionNamedBody<Context.CreateEmbeddingMigrationRequest>,
    Response<Context.EmbeddingMigrationsResponse>
  >
  readonly deleteCollection: Call<CollectionDeleteInput, Operation.Value>
  readonly deletePayload: Call<Context.DeletePayloadRequest & Controls, Response<Context.PayloadMutationResponse>>
  readonly deletePoints: Call<PointMutationInput, Response<Context.PointMutationResponse> | Operation.Value>
  readonly discover: Call<
    WithDefaults<Context.PointDiscoveryRequest, "limit"> & Controls,
    Response<Context.ScoredResponse>
  >
  readonly discoverSources: Call<
    WithDefaults<Context.DiscoveryRequest, "schemaNames"> & Controls,
    Response<Context.DiscoveryResponse>
  >
  readonly dismissOnboarding: Call<EmptyMutationInput, Response<Context.OnboardingResponse>>
  readonly dropCollection: Call<CollectionDeleteInput, Operation.Value>
  readonly dropCollectionAlias: Call<
    Controls & { readonly aliasName: Context.Identifier },
    Response<Context.CollectionAliasDropResponse>
  >
  readonly embeddingMigrations: Call<CollectionNameInput, Response<Context.EmbeddingMigrationsResponse>>
  readonly estimateIndexMemory: Call<IndexInput, Response<Context.IndexMemoryEstimateResponse>>
  readonly evaluateOnboarding: Call<EmptyInput, Response<Context.OnboardingResponse>>
  readonly executeQuery: Call<Context.QueryExecuteRequest & Controls, Response<Context.QueryExecutionResponse>>
  readonly explain: Call<Context.QueryExplainRequest & Controls, Response<Context.QueryExplainResponse>>
  readonly explore: Call<
    WithDefaults<Context.PointDiscoveryRequest, "limit"> & Controls,
    Response<Context.ScoredResponse>
  >
  readonly facet: Call<
    WithDefaults<Context.FacetsRequest, "filter" | "limit"> & Controls,
    Response<Context.FacetsResponse>
  >
  readonly facets: Call<
    WithDefaults<Context.FacetsRequest, "filter" | "limit"> & Controls,
    Response<Context.FacetsResponse>
  >
  readonly getCapabilities: Call<EmptyInput, Response<Context.CapabilitiesResponse>>
  readonly getCollection: Call<CollectionIdInput, Response<Context.CollectionGetResponse>>
  readonly getCollectionDiagnostics: Call<CollectionIdInput, Response<Context.DiagnosticsResponse>>
  readonly getCollectionStatus: Call<CollectionIdInput, Response<Context.CollectionStatusResponse>>
  readonly getOnboarding: Call<EmptyInput, Response<Context.OnboardingResponse>>
  readonly getOperation: Call<OperationIdInput, Operation.Value>
  readonly getPointStatus: Call<CollectionIdInput, Response<Context.PointStatusResponse>>
  readonly graphFirst: Call<
    WithDefaults<
      Context.GraphFirstSearchRequest,
      "direction" | "filter" | "graphLimit" | "limit" | "maxDepth" | "relationshipTypes" | "vectorName"
    > &
      Controls,
    Response<Context.RankedResponse>
  >
  readonly groupedSearch: Call<
    WithDefaults<Context.GroupedSearchRequest, "groupLimit" | "limit" | "vectorName"> & Controls,
    Response<Context.RankedResponse>
  >
  readonly indexAdvisor: Call<CollectionNameInput, Response<Context.IndexAdvisorResponse>>
  readonly indexDiagnostics: Call<IndexInput, Response<Context.IndexDiagnosticsResponse>>
  readonly indexStatus: Call<IndexInput, Response<Context.IndexStatusResponse>>
  readonly joint: Call<
    Omit<Context.JointSearchRequest, "weights"> &
      Controls & {
        readonly semanticWeight?: number
        readonly lexicalWeight?: number
        readonly graphWeight?: number
      },
    Response<Context.JointResponse>
  >
  readonly listCollections: Page.Operation<ListCollectionsInput, Context.Collection, RequestError>
  readonly listFilters: Call<CollectionIdInput, Response<Context.FilterListResponse>>
  readonly listOperations: Page.Operation<ListOperationsInput, Operation.Value, RequestError>
  readonly modelVersions: Call<CollectionNameInput, Response<Context.ModelVersionsResponse>>
  readonly optimizationStatus: Call<CollectionNameInput, Response<Context.OptimizationStatusResponse>>
  readonly preflight: Call<PreflightInput, Response<Context.PreflightResponse>>
  readonly query: Call<
    WithDefaults<Context.TextHybridSearchRequest, "limit" | "vectorName"> & Controls,
    Response<Context.RankedResponse>
  >
  readonly queryCohortStats: Call<CollectionNameInput, Response<Context.QueryCohortStatsResponse>>
  readonly queryExecutionStats: Call<CollectionNameInput, Response<Context.QueryExecutionStatsResponse>>
  readonly queryDiscover: (input: {
    readonly contextPointIds: ReadonlyArray<number>
    readonly limit?: number
  }) => ContextQuery.DiscoverPlan
  readonly queryFormula: (input: {
    readonly branch: ContextQuery.QueryPlan
    readonly formula: string
  }) => ContextQuery.FormulaPlan
  readonly queryFullText: (input: {
    readonly textQuery: string
    readonly textColumn: string
    readonly limit?: number
  }) => ContextQuery.FullTextPlan
  readonly queryLateInteraction: (input: {
    readonly queryVectors: ReadonlyArray<ReadonlyArray<number>>
    readonly candidatesPerQuery: number
    readonly limit?: number
  }) => ContextQuery.LateInteractionPlan
  readonly queryLookup: (input: { readonly pointIds: ReadonlyArray<number> }) => ContextQuery.LookupPlan
  readonly queryNearest: (input: {
    readonly vector: ReadonlyArray<number>
    readonly limit?: number
    readonly vectorName?: string
    readonly filter?: ContextQuery.QueryPlanFilter
  }) => ContextQuery.NearestPlan
  readonly queryPrefetch: (input: {
    readonly branches: ReadonlyArray<ContextQuery.QueryPlan>
  }) => ContextQuery.PrefetchPlan
  readonly queryRecommend: (input: {
    readonly positivePointIds: ReadonlyArray<number>
    readonly negativePointIds: ReadonlyArray<number>
    readonly limit?: number
  }) => ContextQuery.RecommendPlan
  readonly queryRerank: (input: {
    readonly branch: ContextQuery.QueryPlan
    readonly limit: number
  }) => ContextQuery.RerankPlan
  readonly queryScoreThreshold: (input: {
    readonly branch: ContextQuery.QueryPlan
    readonly minScore?: number
    readonly maxScore?: number
  }) => ContextQuery.ScoreThresholdPlan
  readonly querySparseNearest: (input: {
    readonly vectorName: string
    readonly vector: string
    readonly limit?: number
    readonly filter?: ContextQuery.QueryPlanFilter
  }) => ContextQuery.SparseNearestPlan
  readonly queryWeight: (input: {
    readonly branch: ContextQuery.QueryPlan
    readonly weight: number
  }) => ContextQuery.WeightPlan
  readonly rankFusion: Call<
    Omit<Context.RankFusionSearchRequest, "weights"> &
      Controls & { readonly contextWeight?: number; readonly graphWeight?: number },
    Response<Context.RankedResponse>
  >
  readonly rawVectorSearch: Call<
    WithDefaults<Context.RawVectorSearchRequest, "limit"> & Controls,
    Response<Context.RawVectorSearchResponse>
  >
  readonly recallCheck: Call<
    WithDefaults<Context.RecallCheckRequest, "filter" | "limit" | "minimumRecall" | "vectorName"> & Controls,
    Response<Context.RecallCheckResponse>
  >
  readonly recommend: Call<
    WithUnionDefaults<Context.RecommendRequest, "limit" | "negativePointIds" | "negativeVectors"> & Controls,
    Response<Context.ScoredResponse>
  >
  readonly reconcilePoints: Call<CollectionIdMutationInput, Operation.Value>
  readonly refreshOnboarding: Call<EmptyInput, Response<Context.OnboardingResponse>>
  readonly registerFilterColumn: Call<FilterColumnInput, Operation.Value>
  readonly registerJsonbPath: Call<FilterJsonbInput, Operation.Value>
  readonly registerModelVersion: Call<
    CollectionNamedBody<Context.RegisterModelVersionRequest>,
    Response<Context.ModelVersionsResponse>
  >
  readonly registerVector: Call<VectorMutationInput, Operation.Value>
  readonly reindexCollection: Call<CollectionIdMutationInput, Operation.Value>
  readonly retryOperation: Call<OperationIdMutationInput, Operation.Value>
  readonly scroll: Page.Operation<ScrollInput, Context.PointMapping, RequestError>
  readonly scrollPoints: Page.Operation<ScrollInput, Context.PointMapping, RequestError>
  readonly search: Call<
    WithDefaults<Context.DenseSearchRequest, "filter" | "limit" | "vectorName"> & Controls,
    Response<Context.RankedResponse>
  >
  readonly setDefaultCollection: Call<CollectionIdMutationInput, Operation.Value>
  readonly setPayload: Call<Context.SetPayloadRequest & Controls, Response<Context.PayloadMutationResponse>>
  readonly telemetry: Call<CollectionNameInput, Response<Context.TelemetryResponse>>
  readonly textHybrid: Call<
    WithDefaults<Context.TextHybridSearchRequest, "limit" | "vectorName"> & Controls,
    Response<Context.RankedResponse>
  >
  readonly updateCollection: Call<CollectionUpdateInput, Operation.Value>
  readonly updateEmbeddingMigration: Call<
    Context.UpdateEmbeddingMigrationRequest & CollectionNameInput & { readonly migrationId: number },
    Response<Context.EmbeddingMigrationsResponse>
  >
  readonly upsertPoints: Call<PointMutationInput, Response<Context.PointMutationResponse> | Operation.Value>
  readonly vacuumAdvice: Call<IndexInput, Response<Context.VacuumAdviceResponse>>
  readonly vectorFirst: Call<
    WithDefaults<
      Context.VectorFirstSearchRequest,
      "contextLimit" | "direction" | "filter" | "graphLimit" | "limit" | "maxDepth" | "relationshipTypes" | "vectorName"
    > &
      Controls,
    Response<Context.RankedResponse>
  >
  readonly verifyCollection: Call<CollectionIdInput, Response<Context.VerificationResponse>>
  readonly waitForOperation: (
    input: WaitForOperationInput,
  ) => Effect.Effect<Operation.Value, Operation.WaitError | PolygresError.InvalidInput>
}

type Decodable<A> = Schema.Schema<A> & { readonly DecodingServices: never }
type AnySchema = Decodable<unknown>

const requestSchemas: Readonly<Record<string, AnySchema>> = {
  acknowledgeOnboarding: Context.EmptyRequest,
  addFilterColumn: Context.FilterColumnRequest,
  addJsonbFilterPath: Context.FilterJsonbPathRequest,
  addVector: Context.VectorCreateRequest,
  backfillPoints: Context.BackfillPointsRequest,
  bulkDeletePoints: Context.BulkPointKeysRequest,
  bulkUpsertPoints: Context.BulkPointKeysRequest,
  cancelOperation: Context.EmptyRequest,
  candidateSearch: Context.CandidateSearchRequest,
  clearPayload: Context.ClearPayloadRequest,
  configureCollectionLimits: Context.CollectionLimitsRequest,
  configureVector: Context.VectorConfigureRequest,
  count: Context.CountRequest,
  createCollection: Context.CollectionCreateRequest,
  createCollectionAlias: Context.CollectionAliasRequest,
  createEmbeddingMigration: Context.CreateEmbeddingMigrationRequest,
  deleteCollection: Context.CollectionDeleteRequest,
  deletePayload: Context.DeletePayloadRequest,
  deletePoints: Context.PointKeysRequest,
  discover: Context.PointDiscoveryRequest,
  discoverSources: Context.DiscoveryRequest,
  dismissOnboarding: Context.EmptyRequest,
  dropCollection: Context.CollectionDeleteRequest,
  evaluateOnboarding: Context.EmptyRequest,
  executeQuery: Context.QueryExecuteRequest,
  explain: Context.QueryExplainRequest,
  explore: Context.PointDiscoveryRequest,
  facet: Context.FacetsRequest,
  facets: Context.FacetsRequest,
  graphFirst: Context.GraphFirstSearchRequest,
  groupedSearch: Context.GroupedSearchRequest,
  joint: Context.JointSearchRequest,
  preflight: Context.CollectionCreateRequest,
  query: Context.TextHybridSearchRequest,
  rankFusion: Context.RankFusionSearchRequest,
  rawVectorSearch: Context.RawVectorSearchRequest,
  recallCheck: Context.RecallCheckRequest,
  recommend: Context.RecommendRequest,
  reconcilePoints: Context.EmptyRequest,
  refreshOnboarding: Context.EmptyRequest,
  registerFilterColumn: Context.FilterColumnRequest,
  registerJsonbPath: Context.FilterJsonbPathRequest,
  registerModelVersion: Context.RegisterModelVersionRequest,
  registerVector: Context.VectorCreateRequest,
  reindexCollection: Context.EmptyRequest,
  retryOperation: Context.EmptyRequest,
  search: Context.DenseSearchRequest,
  setDefaultCollection: Context.CollectionSetDefaultRequest,
  setPayload: Context.SetPayloadRequest,
  textHybrid: Context.TextHybridSearchRequest,
  updateCollection: Context.CollectionUpdateRequest,
  updateEmbeddingMigration: Context.UpdateEmbeddingMigrationRequest,
  upsertPoints: Context.PointKeysRequest,
  vectorFirst: Context.VectorFirstSearchRequest,
}

const responseSchemas: Readonly<Record<string, AnySchema>> = {
  acknowledgeOnboarding: Context.OnboardingResponse,
  backfillPoints: Context.PointBatchResponse,
  bulkDeletePoints: Context.PointBatchResponse,
  bulkUpsertPoints: Context.PointBatchResponse,
  candidateSearch: Context.ScoredResponse,
  clearPayload: Context.PayloadMutationResponse,
  collectionAliases: Context.CollectionAliasListResponse,
  collectionInfo: Context.PgContextCollectionInfoResponse,
  collectionLimits: Context.CollectionLimitsResponse,
  collectionVectors: Context.CollectionVectorsResponse,
  configureCollectionLimits: Context.CollectionLimitsResponse,
  configureVector: Context.VectorConfigureResponse,
  count: Context.CountResponse,
  createCollectionAlias: Context.CollectionAliasResponse,
  createEmbeddingMigration: Context.EmbeddingMigrationsResponse,
  deletePayload: Context.PayloadMutationResponse,
  deletePoints: Context.PointMutationResponse,
  discover: Context.ScoredResponse,
  discoverSources: Context.DiscoveryResponse,
  dismissOnboarding: Context.OnboardingResponse,
  dropCollectionAlias: Context.CollectionAliasDropResponse,
  embeddingMigrations: Context.EmbeddingMigrationsResponse,
  estimateIndexMemory: Context.IndexMemoryEstimateResponse,
  evaluateOnboarding: Context.OnboardingResponse,
  executeQuery: Context.QueryExecutionResponse,
  explain: Context.QueryExplainResponse,
  explore: Context.ScoredResponse,
  facet: Context.FacetsResponse,
  facets: Context.FacetsResponse,
  getCapabilities: Context.CapabilitiesResponse,
  getCollection: Context.CollectionGetResponse,
  getCollectionDiagnostics: Context.DiagnosticsResponse,
  getCollectionStatus: Context.CollectionStatusResponse,
  getOnboarding: Context.OnboardingResponse,
  getPointStatus: Context.PointStatusResponse,
  graphFirst: Context.RankedResponse,
  groupedSearch: Context.RankedResponse,
  indexAdvisor: Context.IndexAdvisorResponse,
  indexDiagnostics: Context.IndexDiagnosticsResponse,
  indexStatus: Context.IndexStatusResponse,
  joint: Context.JointResponse,
  listFilters: Context.FilterListResponse,
  modelVersions: Context.ModelVersionsResponse,
  optimizationStatus: Context.OptimizationStatusResponse,
  preflight: Context.PreflightResponse,
  query: Context.RankedResponse,
  queryCohortStats: Context.QueryCohortStatsResponse,
  queryExecutionStats: Context.QueryExecutionStatsResponse,
  rankFusion: Context.RankedResponse,
  rawVectorSearch: Context.RawVectorSearchResponse,
  recallCheck: Context.RecallCheckResponse,
  recommend: Context.ScoredResponse,
  refreshOnboarding: Context.OnboardingResponse,
  registerModelVersion: Context.ModelVersionsResponse,
  search: Context.RankedResponse,
  setPayload: Context.PayloadMutationResponse,
  telemetry: Context.TelemetryResponse,
  textHybrid: Context.RankedResponse,
  updateEmbeddingMigration: Context.EmbeddingMigrationsResponse,
  upsertPoints: Context.PointMutationResponse,
  vacuumAdvice: Context.VacuumAdviceResponse,
  vectorFirst: Context.RankedResponse,
  verifyCollection: Context.VerificationResponse,
}

const operationResponses = new Set([
  "addFilterColumn",
  "addJsonbFilterPath",
  "addVector",
  "cancelOperation",
  "createCollection",
  "deleteCollection",
  "dropCollection",
  "getOperation",
  "reconcilePoints",
  "registerFilterColumn",
  "registerJsonbPath",
  "registerVector",
  "reindexCollection",
  "retryOperation",
  "setDefaultCollection",
  "updateCollection",
])
const pointUnionResponses = new Set(["deletePoints", "upsertPoints"])
const expectedOperationKinds: Readonly<Partial<Record<string, Operation.Kind>>> = {
  addFilterColumn: "filter_add_column",
  addJsonbFilterPath: "filter_add_jsonb_path",
  addVector: "vector_add",
  createCollection: "collection_create",
  deleteCollection: "collection_delete",
  deletePoints: "points_delete",
  dropCollection: "collection_delete",
  reconcilePoints: "points_reconcile",
  registerFilterColumn: "filter_add_column",
  registerJsonbPath: "filter_add_jsonb_path",
  registerVector: "vector_add",
  reindexCollection: "collection_reindex",
  setDefaultCollection: "collection_set_default",
  updateCollection: "collection_update",
  upsertPoints: "points_upsert",
}
const operationWireFields = new Set([
  "id",
  "collectionId",
  "kind",
  "status",
  "stage",
  "processedUnits",
  "totalUnits",
  "attempts",
  "retryUntil",
  "error",
  "createdAt",
  "startedAt",
  "finishedAt",
  "updatedAt",
  "resultPayload",
])

const queryNames = new Set(["listCollections", "listOperations", "scroll", "scrollPoints"])
const emptyBodies = new Set([
  "acknowledgeOnboarding",
  "cancelOperation",
  "dismissOnboarding",
  "evaluateOnboarding",
  "reconcilePoints",
  "refreshOnboarding",
  "reindexCollection",
  "retryOperation",
])

const uuid = () => globalThis.crypto.randomUUID()

const inputError = (operation: string, cause: unknown) => {
  const issue =
    cause !== null && typeof cause === "object" && "issue" in cause
      ? (cause as { readonly issue: Parameters<typeof PolygresError.schemaIssues>[0] }).issue
      : undefined
  return new PolygresError.InvalidInput({
    operation,
    message: `Invalid input for ${operation}.`,
    issues: issue === undefined ? [{ path: [], message: "Invalid input" }] : PolygresError.schemaIssues(issue),
  })
}

const requestId = (payload: unknown): string | undefined => {
  if (payload === null || typeof payload !== "object") return undefined
  const value =
    (payload as { readonly request_id?: unknown; readonly requestId?: unknown }).request_id ??
    (payload as { readonly requestId?: unknown }).requestId
  return typeof value === "string" ? PolygresError.redact(value) : undefined
}

const invalidResponse = (
  operation: string,
  response: HttpTransport.Response,
  cause: unknown,
  message = "Polygres returned a response that does not satisfy its declared schema.",
) => {
  const issue =
    cause !== null && typeof cause === "object" && "issue" in cause
      ? (cause as { readonly issue: Parameters<typeof PolygresError.schemaIssues>[0] }).issue
      : undefined
  const id = requestId(response.payload)
  return new PolygresError.InvalidResponse({
    operation,
    status: response.status,
    message,
    ...(id === undefined ? {} : { requestId: id }),
    ...(issue === undefined ? {} : { issues: PolygresError.schemaIssues(issue) }),
  })
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const metadata = (value: unknown, excluded: ReadonlySet<string>): JsonObject =>
  PolygresError.sanitizeDetails(Object.fromEntries(Object.entries(record(value)).filter(([key]) => !excluded.has(key))))

const snake = (value: string) => value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)

const decode = <A>(
  operation: string,
  schema: Decodable<A>,
  response: HttpTransport.Response,
): Effect.Effect<Response<A>, PolygresError.InvalidResponse> =>
  Effect.try({
    try: () => {
      const enriched = ContextWire.decodeResponse(schema, response.payload)
      const shape = Schema.decodeUnknownSync(Schema.toType(schema))(enriched)
      const enrichedRecord = record(enriched)
      const value = Object.fromEntries(Object.keys(shape as object).map((key) => [key, enrichedRecord[key]])) as A
      const id = requestId(response.payload)
      const root = record(ContextWire.normalizeResponse(response.payload))
      const known = new Set(Object.keys(value as object))
      known.add("requestId")
      for (const key of [...known]) known.add(snake(key))
      return {
        ...value,
        ...(id === undefined ? {} : { requestId: id }),
        metadata: metadata(root, known),
      }
    },
    catch: (cause) => invalidResponse(operation, response, cause),
  })

const operationValue = (operation: Context.Operation, payload: unknown, envelopePayload: unknown): Operation.Value => {
  const raw = record(ContextWire.normalizeResponse(payload))
  const failureRaw = record(raw.error)
  return {
    id: operation.id,
    collectionId: operation.collectionId,
    kind: operation.kind,
    status: operation.status,
    stage: operation.stage,
    processedUnits: operation.processedUnits,
    totalUnits: operation.totalUnits,
    attempts: operation.attempts,
    retryUntil: DateTime.formatIso(operation.retryUntil),
    error: operation.error.pipe(
      Option.map((failure) => ({
        code: failure.code,
        message: PolygresError.redact(failure.message),
        details: PolygresError.sanitizeDetails(failure.details),
        httpStatus: failure.httpStatus,
        variant: failure.variant,
        metadata: metadata(failureRaw, new Set(["code", "variant", "message", "details", "httpStatus"])),
      })),
    ),
    createdAt: DateTime.formatIso(operation.createdAt),
    startedAt: operation.startedAt.pipe(Option.map(DateTime.formatIso)),
    finishedAt: operation.finishedAt.pipe(Option.map(DateTime.formatIso)),
    updatedAt: DateTime.formatIso(operation.updatedAt),
    requestId: Option.fromNullishOr(requestId(envelopePayload)),
    metadata: metadata(raw, operationWireFields),
  }
}

interface ExpectedOperation {
  readonly id?: string
  readonly collectionId?: string
  readonly kind?: Operation.Kind
}

const decodeOperation = (
  operationName: string,
  response: HttpTransport.Response,
  expected: ExpectedOperation | undefined,
) =>
  Effect.try({
    try: () => {
      const envelope = ContextWire.decodeResponse(Context.OperationEnvelope, response.payload)
      if (
        (expected?.id !== undefined && envelope.operation.id !== expected.id) ||
        (expected?.collectionId !== undefined &&
          !Option.contains(envelope.operation.collectionId, expected.collectionId)) ||
        (expected?.kind !== undefined && envelope.operation.kind !== expected.kind)
      ) {
        throw new Error("operation identity mismatch")
      }
      const root = record(ContextWire.normalizeResponse(response.payload))
      return operationValue(envelope.operation, root.operation, response.payload)
    },
    catch: (cause) =>
      invalidResponse(
        operationName,
        response,
        cause,
        expected === undefined ? undefined : "Polygres returned a different Context operation than requested.",
      ),
  })

const duration = (operation: string, value: Duration.Input | undefined): Duration.Duration | undefined => {
  if (value === undefined) return undefined
  const parsed = Duration.fromInput(value)
  if (Option.isNone(parsed) || !Duration.isFinite(parsed.value) || Duration.toMillis(parsed.value) <= 0) {
    throw inputError(operation, undefined)
  }
  return parsed.value
}

const defaults = (name: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  if (emptyBodies.has(name)) return input
  if (name === "setDefaultCollection") return { isDefault: true }
  if (name === "createCollection" || name === "preflight")
    return {
      textColumn: null,
      resultColumns: [],
      filterColumns: [],
      jsonbFilterPaths: [],
      indexKind: "hnsw",
      maxSearchLimit: 1_000,
      ...input,
      source: {
        sourceKeyColumn: "id",
        contentColumn: null,
        metadataColumn: null,
        ...record(input.source),
      },
      vector: { name: null, metric: "cosine", ...record(input.vector) },
    }
  if (name === "addVector" || name === "registerVector")
    return { name: null, mode: "existing", metric: "cosine", indexKind: "hnsw", setDefault: false, ...input }
  if (name === "backfillPoints" || name === "bulkDeletePoints" || name === "bulkUpsertPoints")
    return { batchSize: 1_000, ...input }
  if (name === "configureCollectionLimits")
    return {
      maxDimensions: null,
      maxVectors: null,
      maxPoints: null,
      maxFilterNodes: null,
      maxSearchLimit: null,
      maxCandidateBudget: null,
      queryTimeoutMs: null,
      maxIndexMemoryBytes: null,
      ...input,
    }
  if (name === "count") return { filter: null, ...input }
  if (name === "facet" || name === "facets") return { filter: null, limit: 10, ...input }
  if (name === "candidateSearch" || name === "search" || name === "recallCheck")
    return {
      vectorName: null,
      filter: null,
      limit: 10,
      ...(name === "recallCheck" ? { minimumRecall: 0.95 } : {}),
      ...input,
    }
  if (name === "groupedSearch") return { vectorName: null, groupLimit: 1, limit: 10, ...input }
  if (name === "query" || name === "textHybrid") return { vectorName: null, limit: 10, ...input }
  if (name === "discover" || name === "explore" || name === "rawVectorSearch") return { limit: 10, ...input }
  if (name === "recommend")
    return "positivePointIds" in input
      ? { negativePointIds: [], limit: 10, ...input }
      : { negativeVectors: [], limit: 10, ...input }
  if (name === "graphFirst")
    return {
      vectorName: null,
      maxDepth: 2,
      graphLimit: 200,
      relationshipTypes: [],
      direction: "any",
      filter: null,
      limit: 10,
      ...input,
    }
  if (name === "vectorFirst")
    return {
      vectorName: null,
      contextLimit: 50,
      maxDepth: 2,
      graphLimit: 200,
      relationshipTypes: [],
      direction: "any",
      filter: null,
      limit: 10,
      ...input,
    }
  if (name === "rankFusion")
    return {
      vectorName: null,
      contextLimit: 50,
      maxDepth: 2,
      graphLimit: 200,
      relationshipTypes: [],
      direction: "any",
      weights: { context: 0.7, graph: 0.3 },
      filter: null,
      limit: 10,
      ...input,
    }
  if (name === "joint")
    return {
      vectorName: null,
      query: null,
      starts: [],
      filter: null,
      relationshipTypes: [],
      direction: "any",
      maxDepth: 2,
      contextLimit: 50,
      seedLimit: 8,
      graphLimit: 200,
      traversalLimit: 500,
      weights: { semantic: 0.7, lexical: 0, graph: 0.3 },
      limit: 10,
      ...input,
    }
  return input
}

const bodyInput = (binding: ContextOperationBinding, input: Readonly<Record<string, unknown>>) => {
  const excluded = new Set(["timeout", "idempotencyKey"])
  for (const match of binding.path.matchAll(/\{([a-z_]+)\}/g)) {
    const key = match[1]
    if (key !== undefined)
      excluded.add(key.replace(/_([a-z])/g, (_match, character: string) => character.toUpperCase()))
  }
  if (queryNames.has(binding.publicName)) {
    for (const key of ["collectionId", "cursor", "kind", "limit", "status"]) excluded.add(key)
  }
  const body = Object.fromEntries(Object.entries(input).filter(([key]) => !excluded.has(key)))
  const name = binding.publicName
  if (name === "createEmbeddingMigration" || name === "registerModelVersion") body.collection = input.collectionName
  if (name === "rankFusion") {
    const contextWeight = body.contextWeight ?? 0.7
    const graphWeight = body.graphWeight ?? 0.3
    delete body.contextWeight
    delete body.graphWeight
    body.weights = { context: contextWeight, graph: graphWeight }
  }
  if (name === "joint") {
    const semanticWeight = body.semanticWeight ?? 0.7
    const lexicalWeight = body.lexicalWeight ?? 0
    const graphWeight = body.graphWeight ?? 0.3
    delete body.semanticWeight
    delete body.lexicalWeight
    delete body.graphWeight
    body.weights = { semantic: semanticWeight, lexical: lexicalWeight, graph: graphWeight }
  }
  return defaults(name, body)
}

const path = (binding: ContextOperationBinding, input: Readonly<Record<string, unknown>>) =>
  binding.path.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    const camel = key.replace(/_([a-z])/g, (_match, character: string) => character.toUpperCase())
    const value = input[camel]
    if (value === undefined) throw inputError(`context.${binding.publicName}`, undefined)
    const validated =
      key === "collection_id" || key === "operation_id"
        ? ContextWire.encodeRequest(Context.Uuid, value)
        : key === "migration_id"
          ? ContextWire.encodeRequest(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), value)
          : ContextWire.encodeRequest(Context.Identifier, value)
    return encodeURIComponent(String(validated))
  })

const query = (name: string, input: Readonly<Record<string, unknown>>) => {
  if (name === "listCollections") {
    return record(
      ContextWire.encodeRequest(
        Schema.Struct({
          status: Schema.optionalKey(Context.CollectionStatus),
          limit: Context.AdminPageLimit,
          cursor: Schema.optionalKey(Schema.String),
        }),
        {
          limit: input.limit ?? 50,
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        },
      ),
    ) as Readonly<Record<string, string | number | boolean | null | undefined>>
  }
  if (name === "listOperations") {
    return record(
      ContextWire.encodeRequest(
        Schema.Struct({
          collectionId: Schema.optionalKey(Context.Uuid),
          kind: Schema.optionalKey(Context.OperationKind),
          status: Schema.optionalKey(Context.OperationStatus),
          limit: Context.AdminPageLimit,
          cursor: Schema.optionalKey(Schema.String),
        }),
        {
          limit: input.limit ?? 50,
          ...(input.collectionId === undefined ? {} : { collectionId: input.collectionId }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        },
      ),
    ) as Readonly<Record<string, string | number | boolean | null | undefined>>
  }
  if (name === "scroll" || name === "scrollPoints") {
    return record(
      ContextWire.encodeRequest(
        Schema.Struct({ limit: Context.PointPageLimit, cursor: Schema.optionalKey(Schema.String) }),
        { limit: input.limit ?? 50, ...(input.cursor === undefined ? {} : { cursor: input.cursor }) },
      ),
    ) as Readonly<Record<string, string | number | boolean | null | undefined>>
  }
  return undefined
}

interface Prepared {
  readonly request: HttpTransport.Request
  readonly expectedOperation?: ExpectedOperation
}

type CapabilityField =
  | "count"
  | "denseSearch"
  | "facets"
  | "graphFirst"
  | "groupedSearch"
  | "joint"
  | "pointScroll"
  | "rankFusion"
  | "recallCheck"
  | "textHybrid"
  | "vectorFirst"

interface CapabilityRequirement {
  readonly field: CapabilityField
  readonly wireName: string
  readonly validateLimits: boolean
}

const capabilityRequirements: Readonly<Record<string, CapabilityRequirement>> = {
  scroll: { field: "pointScroll", wireName: "point_scroll", validateLimits: false },
  scrollPoints: { field: "pointScroll", wireName: "point_scroll", validateLimits: false },
  count: { field: "count", wireName: "count", validateLimits: true },
  facet: { field: "facets", wireName: "facets", validateLimits: false },
  facets: { field: "facets", wireName: "facets", validateLimits: false },
  search: { field: "denseSearch", wireName: "dense_search", validateLimits: true },
  groupedSearch: { field: "groupedSearch", wireName: "grouped_search", validateLimits: true },
  recallCheck: { field: "recallCheck", wireName: "recall_check", validateLimits: true },
  query: { field: "textHybrid", wireName: "text_hybrid", validateLimits: true },
  textHybrid: { field: "textHybrid", wireName: "text_hybrid", validateLimits: true },
  graphFirst: { field: "graphFirst", wireName: "graph_first", validateLimits: true },
  vectorFirst: { field: "vectorFirst", wireName: "vector_first", validateLimits: true },
  rankFusion: { field: "rankFusion", wireName: "rank_fusion", validateLimits: true },
  joint: { field: "joint", wireName: "joint", validateLimits: true },
}

const capabilityInputError = (
  operation: string,
  message: string,
  code: "CONTEXT_CAPABILITY_UNAVAILABLE" | "CONTEXT_LIMIT_EXCEEDED",
  details: JsonObject,
) =>
  new PolygresError.InvalidInput({
    operation,
    message,
    code,
    details,
    issues: [{ path: [], message }],
  })

const validateCapabilityLimits = (
  operation: string,
  capabilities: Response<Context.CapabilitiesResponse>,
  payload: Readonly<Record<string, unknown>>,
): Effect.Effect<void, PolygresError.InvalidInput> => {
  const limits = [
    ["limit", capabilities.maxSearchLimit],
    ["context_limit", capabilities.maxContextLimit],
    ["graph_limit", capabilities.maxGraphLimit],
    ["seed_limit", capabilities.maxJointSeedLimit],
    ["traversal_limit", capabilities.maxJointTraversalLimit],
    ["max_depth", capabilities.maxGraphDepth],
  ] as const
  for (const [field, maximum] of limits) {
    const value = payload[field]
    if (typeof value === "number" && value > maximum) {
      return Effect.fail(
        capabilityInputError(
          operation,
          `${field} must be ${maximum} or less for this project`,
          "CONTEXT_LIMIT_EXCEEDED",
          { field, limit: maximum },
        ),
      )
    }
  }
  const embedding = payload.embedding
  if (Array.isArray(embedding) && embedding.length > capabilities.maxDimensions) {
    return Effect.fail(
      capabilityInputError(
        operation,
        `embedding must contain at most ${capabilities.maxDimensions} dimensions`,
        "CONTEXT_LIMIT_EXCEEDED",
        { field: "embedding", limit: capabilities.maxDimensions },
      ),
    )
  }
  const relationshipTypes = payload.relationship_types
  if (Array.isArray(relationshipTypes) && relationshipTypes.length > capabilities.maxRelationshipTypes) {
    return Effect.fail(
      capabilityInputError(
        operation,
        "relationship_types exceeds this project's capability limit",
        "CONTEXT_LIMIT_EXCEEDED",
        { field: "relationship_types", limit: capabilities.maxRelationshipTypes },
      ),
    )
  }
  return Effect.void
}

const prepare = (
  binding: ContextOperationBinding,
  inputValue: unknown,
  key: string | undefined,
): Effect.Effect<Prepared, PolygresError.InvalidInput> => {
  const operation = `context.${binding.publicName}`
  try {
    const input = record(inputValue)
    if (inputValue === null || typeof inputValue !== "object" || Array.isArray(inputValue))
      throw inputError(operation, undefined)
    const requestSchema = requestSchemas[binding.publicName]
    if (requestSchema === undefined) {
      const allowed = new Set(["timeout"])
      for (const match of binding.path.matchAll(/\{([a-z_]+)\}/g)) {
        const key = match[1]
        if (key !== undefined)
          allowed.add(key.replace(/_([a-z])/g, (_match, character: string) => character.toUpperCase()))
      }
      if (queryNames.has(binding.publicName)) {
        for (const key of ["collectionId", "cursor", "kind", "limit", "status"]) allowed.add(key)
      }
      if (Object.keys(input).some((key) => !allowed.has(key))) throw inputError(operation, undefined)
    }
    if (binding.retryPolicy !== "idempotentMutation" && input.idempotencyKey !== undefined) {
      throw inputError(operation, undefined)
    }
    if (input.headers !== undefined) throw inputError(operation, undefined)
    const body =
      requestSchema === undefined ? undefined : ContextWire.encodeRequest(requestSchema, bodyInput(binding, input))
    if (key !== undefined) ContextWire.encodeRequest(Context.IdempotencyKey, key)
    if (
      (binding.publicName === "deleteCollection" || binding.publicName === "dropCollection") &&
      input.confirmCollectionId !== input.collectionId
    ) {
      throw inputError(operation, undefined)
    }
    const timeout = duration(operation, input.timeout as Duration.Input | undefined)
    const queryParams = queryNames.has(binding.publicName) ? query(binding.publicName, input) : undefined
    const expectedId =
      binding.publicName === "getOperation" ||
      binding.publicName === "cancelOperation" ||
      binding.publicName === "retryOperation"
        ? String(input.operationId)
        : undefined
    const expectedCollectionId = typeof input.collectionId === "string" ? input.collectionId : undefined
    const expectedKind = expectedOperationKinds[binding.publicName]
    return Effect.succeed({
      request: {
        operation,
        method: binding.method,
        path: path(binding, input).replace(/^\/v1(?=\/)/, ""),
        retry:
          binding.retryPolicy === "never"
            ? "never"
            : binding.retryPolicy === "idempotentMutation"
              ? "idempotentMutation"
              : "readOnly",
        expectedStatuses: pointUnionResponses.has(binding.publicName)
          ? [200, 202]
          : operationResponses.has(binding.publicName)
            ? binding.publicName === "cancelOperation" || binding.publicName === "getOperation"
              ? [200]
              : [202]
            : [200],
        ...(queryParams === undefined ? {} : { query: queryParams }),
        ...(body === undefined ? {} : { body }),
        ...(key === undefined ? {} : { headers: { "Idempotency-Key": key } }),
        ...(timeout === undefined ? {} : { timeout }),
      },
      ...(expectedId === undefined && expectedCollectionId === undefined && expectedKind === undefined
        ? {}
        : {
            expectedOperation: {
              ...(expectedId === undefined ? {} : { id: expectedId }),
              ...(expectedCollectionId === undefined ? {} : { collectionId: expectedCollectionId }),
              ...(expectedKind === undefined ? {} : { kind: expectedKind }),
            },
          }),
    })
  } catch (cause) {
    return Effect.fail(cause instanceof PolygresError.InvalidInput ? cause : inputError(operation, cause))
  }
}

const page = <A>(
  operation: string,
  schema: AnySchema,
  itemsKey: string,
  map: (item: unknown, requestId: string | undefined, rawItem: unknown) => A,
  response: HttpTransport.Response,
): Effect.Effect<Page.Value<A>, PolygresError.InvalidResponse> =>
  decode(operation, schema, response).pipe(
    Effect.map((value) => {
      const result = value as unknown as Readonly<Record<string, unknown>>
      const id = requestId(response.payload)
      const rawItems = record(ContextWire.normalizeResponse(response.payload))[itemsKey]
      return {
        items: (result[itemsKey] as ReadonlyArray<unknown>).map((item, index) =>
          map(item, id, Array.isArray(rawItems) ? rawItems[index] : undefined),
        ),
        nextCursor: result.nextCursor as Option.Option<string>,
        hasMore: result.hasMore as boolean,
        requestId: Option.fromNullishOr(id),
        metadata: value.metadata,
      }
    }),
  )

export interface MakeOptions {
  readonly deadline?: Duration.Duration
}

export const make = (transport: HttpTransport.Service, options: MakeOptions = {}): ContextService => {
  const service: Record<string, unknown> = {}
  const operations = contextBindings.filter(
    (binding): binding is ContextOperationBinding => binding.kind === "operation",
  )
  const capabilitiesBinding = operations.find((binding) => binding.publicName === "getCapabilities")
  if (capabilitiesBinding === undefined) throw new Error("Missing getCapabilities binding")
  let capabilitiesCache:
    | { readonly value: Response<Context.CapabilitiesResponse>; readonly cachedAt: bigint }
    | undefined

  const complete = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
    options.deadline === undefined
      ? effect
      : effect.pipe(
          Effect.timeoutOrElse({
            duration: options.deadline,
            orElse: () =>
              Effect.fail(
                new PolygresError.RequestTimeout({
                  operation,
                  kind: "deadline",
                  message: `Polygres exceeded the operation deadline for ${operation}.`,
                  details: {},
                }),
              ),
          }),
        )

  const fetchCapabilities = (timeout: Duration.Duration | undefined) =>
    prepare(capabilitiesBinding, timeout === undefined ? {} : { timeout }, undefined).pipe(
      Effect.flatMap(({ request }) => transport.requestWithMetadata(request)),
      Effect.flatMap((response) => decode("context.getCapabilities", Context.CapabilitiesResponse, response)),
      Effect.flatMap((value) =>
        Clock.monotonicTimeNanos.pipe(
          Effect.map((cachedAt) => {
            capabilitiesCache = { value, cachedAt }
            return value
          }),
        ),
      ),
    )

  const validateCapability = (name: string, request: HttpTransport.Request): Effect.Effect<void, RequestError> => {
    const requirement = capabilityRequirements[name]
    if (requirement === undefined) return Effect.void
    return Effect.gen(function* () {
      const now = yield* Clock.monotonicTimeNanos
      const cached = capabilitiesCache
      const capabilities =
        cached === undefined || now - cached.cachedAt >= 60_000_000_000n || !cached.value[requirement.field]
          ? yield* fetchCapabilities(request.timeout)
          : cached.value
      if (!capabilities[requirement.field]) {
        const blocker = Option.getOrNull(capabilities[`${requirement.field}Blocker`])
        const blockerMessage = Option.getOrUndefined(capabilities[`${requirement.field}BlockerMessage`])
        const message = blockerMessage ?? `Context ${requirement.wireName.replaceAll("_", " ")} is unavailable.`
        return yield* capabilityInputError(request.operation, message, "CONTEXT_CAPABILITY_UNAVAILABLE", {
          capability: requirement.wireName,
          blocker,
        })
      }
      if (requirement.validateLimits) {
        yield* validateCapabilityLimits(request.operation, capabilities, record(request.body))
      }
    }).pipe(Effect.asVoid)
  }

  for (const binding of operations) {
    if (binding.pagination === "cursor") continue
    service[binding.publicName] = (input: unknown) => {
      const supplied = record(input).idempotencyKey
      const key =
        binding.retryPolicy === "idempotentMutation"
          ? supplied === undefined
            ? uuid()
            : typeof supplied === "string"
              ? supplied
              : ""
          : undefined
      const prepared = prepare(binding, input, key)
      if (binding.publicName === "getCapabilities") {
        return complete(
          "context.getCapabilities",
          prepared.pipe(Effect.flatMap(({ request }) => fetchCapabilities(request.timeout))),
        )
      }
      const effect = prepared.pipe(
        Effect.flatMap(({ expectedOperation, request }) =>
          validateCapability(binding.publicName, request).pipe(
            Effect.flatMap(() => transport.requestWithMetadata(request)),
            Effect.map((response) => ({ expectedOperation, response })),
          ),
        ),
        Effect.flatMap(({ expectedOperation, response }) => {
          if (operationResponses.has(binding.publicName))
            return decodeOperation(`context.${binding.publicName}`, response, expectedOperation)
          if (pointUnionResponses.has(binding.publicName) && response.status === 202)
            return decodeOperation(`context.${binding.publicName}`, response, expectedOperation)
          const schema = responseSchemas[binding.publicName]
          const decoded =
            schema === undefined
              ? Effect.fail(invalidResponse(`context.${binding.publicName}`, response, undefined))
              : decode(`context.${binding.publicName}`, schema, response)
          return pointUnionResponses.has(binding.publicName)
            ? decoded.pipe(
                Effect.flatMap((value) =>
                  record(value).collectionId === expectedOperation?.collectionId
                    ? Effect.succeed(value)
                    : Effect.fail(
                        invalidResponse(
                          `context.${binding.publicName}`,
                          response,
                          undefined,
                          "Polygres returned a point mutation for a different Context collection.",
                        ),
                      ),
                ),
              )
            : decoded
        }),
      )
      return complete(`context.${binding.publicName}`, effect)
    }
  }

  const cursorOperation = <Input extends { readonly cursor?: string }, A>(
    name: string,
    schema: AnySchema,
    itemsKey: string,
    map: (item: unknown, id: string | undefined, rawItem: unknown) => A,
  ) => {
    const binding = operations.find((item) => item.publicName === name)
    if (binding === undefined) throw new Error(`Missing Context binding: ${name}`)
    return Page.makeOperation<Input, A, RequestError>((input) =>
      complete(
        `context.${name}`,
        prepare(binding, input, undefined).pipe(
          Effect.flatMap(({ request }) =>
            validateCapability(name, request).pipe(Effect.flatMap(() => transport.requestWithMetadata(request))),
          ),
          Effect.flatMap((response) => page(`context.${name}`, schema, itemsKey, map, response)),
        ),
      ),
    )
  }

  service.listCollections = cursorOperation<ListCollectionsInput, Context.Collection>(
    "listCollections",
    Context.CollectionListResponse,
    "collections",
    (item) => item as Context.Collection,
  )
  service.listOperations = cursorOperation<ListOperationsInput, Operation.Value>(
    "listOperations",
    Context.OperationListResponse,
    "operations",
    (item, id, rawItem) => operationValue(item as Context.Operation, rawItem, { requestId: id }),
  )
  service.scroll = cursorOperation<ScrollInput, Context.PointMapping>(
    "scroll",
    Context.PointScrollResponse,
    "points",
    (item) => item as Context.PointMapping,
  )
  service.scrollPoints = cursorOperation<ScrollInput, Context.PointMapping>(
    "scrollPoints",
    Context.PointScrollResponse,
    "points",
    (item) => item as Context.PointMapping,
  )

  const getOperationForWait: OperationWait.GetOperation<PolygresError.Request | PolygresError.InvalidInput, never> = (
    operationId,
    remaining,
  ) => {
    const binding = operations.find((item) => item.publicName === "getOperation")
    if (binding === undefined) return Effect.die("Missing getOperation binding")
    return prepare(binding, { operationId, timeout: remaining }, undefined).pipe(
      Effect.flatMap(({ request }) =>
        transport.requestWithMetadata({ ...request, operation: "context.waitForOperation", timeout: remaining }),
      ),
      Effect.flatMap((response) =>
        decodeOperation("context.waitForOperation", response, { id: operationId }).pipe(
          Effect.map((operation) => ({
            _tag: "PollResult" as const,
            operation,
            ...(response.retryAfterMillis === undefined ? {} : { retryAfterMillis: response.retryAfterMillis }),
          })),
        ),
      ),
    )
  }
  const waiter = OperationWait.make(getOperationForWait)
  service.waitForOperation = (input: WaitForOperationInput) => {
    try {
      ContextWire.encodeRequest(Context.Uuid, input.operationId)
      if (input.initial !== undefined && input.initial.id !== input.operationId) {
        throw inputError("context.waitForOperation", undefined)
      }
      return complete(
        "context.waitForOperation",
        waiter(input.operationId, {
          ...(input.initial === undefined ? {} : { initial: input.initial }),
          ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
        }),
      )
    } catch (cause) {
      return Effect.fail(
        cause instanceof PolygresError.InvalidInput ? cause : inputError("context.waitForOperation", cause),
      )
    }
  }

  service.queryNearest = ({ vector, limit = 10, vectorName, filter }: Parameters<ContextService["queryNearest"]>[0]) =>
    ContextQuery.queryNearest(vector, limit, {
      ...(vectorName === undefined ? {} : { vectorName }),
      ...(filter === undefined ? {} : { filter }),
    })
  service.querySparseNearest = ({
    vectorName,
    vector,
    limit = 10,
    filter,
  }: Parameters<ContextService["querySparseNearest"]>[0]) =>
    ContextQuery.querySparseNearest(vectorName, vector, limit, filter === undefined ? {} : { filter })
  service.queryFullText = ({ textQuery, textColumn, limit = 10 }: Parameters<ContextService["queryFullText"]>[0]) =>
    ContextQuery.queryFullText(textQuery, textColumn, limit)
  service.queryLateInteraction = ({
    queryVectors,
    candidatesPerQuery,
    limit = 10,
  }: Parameters<ContextService["queryLateInteraction"]>[0]) =>
    ContextQuery.queryLateInteraction(queryVectors, candidatesPerQuery, limit)
  service.queryRecommend = ({
    positivePointIds,
    negativePointIds,
    limit = 10,
  }: Parameters<ContextService["queryRecommend"]>[0]) =>
    ContextQuery.queryRecommend(positivePointIds, negativePointIds, limit)
  service.queryDiscover = ({ contextPointIds, limit = 10 }: Parameters<ContextService["queryDiscover"]>[0]) =>
    ContextQuery.queryDiscover(contextPointIds, limit)
  service.queryLookup = ({ pointIds }: Parameters<ContextService["queryLookup"]>[0]) =>
    ContextQuery.queryLookup(pointIds)
  service.queryPrefetch = ({ branches }: Parameters<ContextService["queryPrefetch"]>[0]) =>
    ContextQuery.queryPrefetch(branches)
  service.queryWeight = ({ branch, weight }: Parameters<ContextService["queryWeight"]>[0]) =>
    ContextQuery.queryWeight(branch, weight)
  service.queryScoreThreshold = ({
    branch,
    minScore,
    maxScore,
  }: Parameters<ContextService["queryScoreThreshold"]>[0]) =>
    ContextQuery.queryScoreThreshold(branch, minScore, maxScore)
  service.queryFormula = ({ branch, formula }: Parameters<ContextService["queryFormula"]>[0]) =>
    ContextQuery.queryFormula(branch, formula)
  service.queryRerank = ({ branch, limit }: Parameters<ContextService["queryRerank"]>[0]) =>
    ContextQuery.queryRerank(branch, limit)

  return service as unknown as ContextService
}
