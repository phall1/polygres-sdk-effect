import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import type { HttpClient } from "effect/unstable/http"

import type * as Graph from "./Graph.js"
import * as GraphSchema from "./Graph.js"
import type * as Hybrid from "./Hybrid.js"
import * as HybridSchema from "./Hybrid.js"
import * as ContextClient from "./internal/ContextClient.js"
import * as HttpTransport from "./internal/HttpTransport.js"
import * as OperationWait from "./internal/OperationWait.js"
import * as RowsWire from "./internal/RowsWire.js"
import * as Wire from "./internal/Wire.js"
import * as Operation from "./Operation.js"
import * as Page from "./Page.js"
import * as PolygresError from "./PolygresError.js"
import type * as Rows from "./Rows.js"
import * as RowsSchema from "./Rows.js"
import type * as Runtime from "./Runtime.js"
import * as RuntimeSchema from "./Runtime.js"
import type * as Text from "./Text.js"
import * as TextSchema from "./Text.js"
import type * as Vector from "./Vector.js"
import * as VectorSchema from "./Vector.js"

export const VERSION = "0.1.0"
export const API_VERSION = "2026-08-04"

const protectedHeaders = new Set([
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "user-agent",
  "x-polygres-api-version",
  "x-polygres-client-info",
])

export interface Options {
  readonly apiKey: Redacted.Redacted | string
  readonly projectId?: string
  readonly projectMode?: "standard" | "synced"
  readonly runtimeUrl?: string
  readonly timeout?: Duration.Input
  readonly deadline?: Duration.Input
  readonly maxRetries?: number
  readonly headers?: Readonly<Record<string, string>>
}

export interface GraphService {
  readonly expand: Page.Operation<Graph.ExpandInput, Graph.Result>
  readonly neighborhood: Page.Operation<Graph.NeighborhoodInput, Graph.Result>
  readonly related: Page.Operation<Graph.RelatedInput, Graph.Result>
  readonly path: (input: Graph.PathInput) => Effect.Effect<Graph.PathResponse, PolygresError.Search>
  readonly connection: (input: Graph.ConnectionInput) => Effect.Effect<Graph.ConnectionResponse, PolygresError.Search>
}

export interface VectorService {
  readonly search: Page.Operation<Vector.SearchInput, Vector.Result>
  readonly similarTo: Page.Operation<Vector.SimilarToInput, Vector.Result>
}

export interface TextService {
  readonly tsvector: Page.Operation<Text.SearchInput, Text.Result>
  readonly fuzzy: Page.Operation<Text.SearchInput, Text.Result>
}

export interface HybridService {
  readonly graphFirst: Page.Operation<Hybrid.GraphFirstInput, Hybrid.Result>
  readonly vectorFirst: Page.Operation<Hybrid.VectorFirstInput, Hybrid.Result>
  readonly joint: Page.Operation<Hybrid.JointInput, Hybrid.Result>
}

export interface RowsService {
  readonly validate: (input: Rows.ValidateInput) => Effect.Effect<Rows.WriteValidation, PolygresError.Search>
  readonly insert: (input: Rows.InsertInput) => Effect.Effect<Rows.WriteResult, PolygresError.Write>
  readonly upsert: (input: Rows.UpsertInput) => Effect.Effect<Rows.WriteResult, PolygresError.Write>
  readonly ignore: (input: Rows.IgnoreInput) => Effect.Effect<Rows.WriteResult, PolygresError.Write>
}

export type ContextService = ContextClient.ContextService

export interface Service {
  readonly readiness: () => Effect.Effect<Runtime.Readiness, PolygresError.Request>
  readonly connectionInfo: () => Effect.Effect<Runtime.ConnectionInfo, PolygresError.Request>
  readonly graph: GraphService
  readonly vector: VectorService
  readonly text: TextService
  readonly hybrid: HybridService
  readonly rows: RowsService
  readonly context: ContextService
}

export class Client extends Context.Service<Client, Service>()("polygres-sdk-effect/Polygres") {}

type InputSchema<A> = Schema.Schema<A> & { readonly DecodingServices: never }
type ResponseSchema<A> = Schema.Schema<A> & { readonly DecodingServices: never }

const parseInput = <A>(operation: string, schema: InputSchema<A>, input: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(
      (cause) =>
        new PolygresError.InvalidInput({
          operation,
          message: `Invalid input for ${operation}.`,
          issues: PolygresError.schemaIssues(cause.issue),
        }),
    ),
  )

const mapDirection = (direction: Graph.Direction | undefined, fallback: Graph.Direction) => {
  const value = direction ?? fallback
  return value === "both" ? "any" : value
}

const traversalBody = (
  input: {
    readonly maxDepth?: number
    readonly relationshipTypes?: ReadonlyArray<string>
    readonly direction?: Graph.Direction
  },
  defaults: { readonly maxDepth: number; readonly direction: Graph.Direction },
) => ({
  max_depth: input.maxDepth ?? defaults.maxDepth,
  relationship_types: input.relationshipTypes,
  direction: mapDirection(input.direction, defaults.direction),
})

const graphSearchBody = (
  input: Graph.ExpandInput | Graph.NeighborhoodInput | Graph.RelatedInput,
  defaults: { readonly maxDepth: number; readonly direction: Graph.Direction; readonly limit: number },
) => ({
  ...traversalBody(
    {
      ...("maxDepth" in input && input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
      ...(input.relationshipTypes === undefined ? {} : { relationshipTypes: input.relationshipTypes }),
      ...(input.direction === undefined ? {} : { direction: input.direction }),
    },
    defaults,
  ),
  start: input.start,
  filters: input.filters ?? {},
  target_table: input.targetTable,
  limit: input.limit ?? defaults.limit,
  cursor: input.cursor,
})

const vectorBody = (input: Vector.SearchInput | Vector.SimilarToInput) => ({
  config: input.config,
  limit: input.limit,
  filters: input.filters ?? {},
  max_distance: input.maxDistance,
  min_similarity: input.minSimilarity,
  include_values: input.includeValues ?? false,
  cursor: input.cursor,
})

const hybridBody = (
  input: Hybrid.GraphFirstInput | Hybrid.VectorFirstInput | Hybrid.JointInput,
  defaults: { readonly maxDepth: number; readonly limit: number; readonly vectorLimit?: number },
) => ({
  embedding: input.embedding,
  start: input.start,
  config: input.config,
  max_depth: input.maxDepth ?? defaults.maxDepth,
  relationship_types: input.relationshipTypes,
  direction: mapDirection(input.direction, "any"),
  filters: input.filters ?? {},
  weights: {
    vector: input.vectorWeight ?? 0.7,
    graph: input.graphWeight ?? 0.3,
  },
  vector_limit: input.vectorLimit ?? defaults.vectorLimit,
  limit: input.limit ?? defaults.limit,
  cursor: input.cursor,
})

const validateVectorThresholds = <A extends { readonly maxDistance?: number; readonly minSimilarity?: number }>(
  operation: string,
  input: A,
) =>
  input.maxDistance !== undefined && input.minSimilarity !== undefined
    ? Effect.fail(
        new PolygresError.InvalidInput({
          operation,
          message: "maxDistance and minSimilarity are mutually exclusive.",
          issues: [{ path: [], message: "Choose maxDistance or minSimilarity, not both" }],
        }),
      )
    : Effect.succeed(input)

const invalidRowInput = (operation: string, path: ReadonlyArray<string>, message: string) =>
  Effect.fail(
    new PolygresError.InvalidInput({
      operation,
      message: `Invalid input for ${operation}.`,
      issues: [{ path: [...path], message }],
    }),
  )

const validateRowMode = (operation: string, input: Rows.ValidateInput) => {
  const mode = input.mode ?? "insert"
  if (mode === "insert" && ((input.conflictColumns?.length ?? 0) > 0 || input.updateColumns !== undefined)) {
    return invalidRowInput(operation, ["mode"], "insert does not accept conflict or update columns")
  }
  if ((mode === "upsert" || mode === "ignore") && (input.conflictColumns?.length ?? 0) === 0) {
    return invalidRowInput(operation, ["conflictColumns"], `${mode} requires conflictColumns`)
  }
  if (mode === "ignore" && input.updateColumns !== undefined) {
    return invalidRowInput(operation, ["updateColumns"], "ignore does not accept updateColumns")
  }
  return Effect.succeed({ ...input, mode })
}

type RowWriteInput = Rows.InsertInput | Rows.UpsertInput | Rows.IgnoreInput
const isContextRequested = (input: Rows.ValidateInput | RowWriteInput) =>
  input.reconcileContext === true || input.contextCollectionId !== undefined

const validateRowWrite = <A extends RowWriteInput>(operation: string, input: A) => {
  const contextRequested = isContextRequested(input)
  if (contextRequested && input.idempotencyKey === undefined) {
    return invalidRowInput(operation, ["idempotencyKey"], "Context-backed row writes require idempotencyKey")
  }
  if (!contextRequested && input.idempotencyKey !== undefined) {
    return invalidRowInput(operation, ["idempotencyKey"], "idempotencyKey requires Context reconciliation")
  }
  if (
    input.waitForContext === true &&
    (input.waitTimeout === undefined || input.waitTimeout > 0) &&
    Number.isFinite(input.waitTimeout ?? 300)
  ) {
    return Effect.succeed(input)
  }
  if (input.waitForContext !== true) return Effect.succeed(input)
  return invalidRowInput(operation, ["waitTimeout"], "waitTimeout must be a positive finite number")
}

const rowBody = (input: Rows.ValidateInput | RowWriteInput, mode: Rows.Mode) => {
  const contextRequested = isContextRequested(input)
  return {
    mode,
    row: input.row,
    returning: input.returning ?? [],
    ...(!("conflictColumns" in input) || input.conflictColumns === undefined
      ? {}
      : { conflict_columns: input.conflictColumns }),
    ...(!("updateColumns" in input) || input.updateColumns === undefined
      ? {}
      : { update_columns: input.updateColumns }),
    ...(contextRequested
      ? {
          context: {
            reconcile: true,
            ...(input.contextCollectionId === undefined ? {} : { collection_id: input.contextCollectionId }),
          },
        }
      : {}),
  }
}

const rowPath = (input: { readonly schema: string; readonly table: string }, validate = false) =>
  `/tables/${encodeURIComponent(input.schema)}/${encodeURIComponent(input.table)}/rows${validate ? "/validate" : ""}`

const errorCode = (error: PolygresError.Request): string | undefined =>
  "code" in error && typeof error.code === "string" ? error.code : undefined

const errorStatus = (error: PolygresError.Request): number | undefined =>
  "status" in error && typeof error.status === "number" ? error.status : undefined

const ambiguousWrite = (
  operation: string,
  error: PolygresError.Request,
): PolygresError.Request | PolygresError.AmbiguousWrite => {
  if (error instanceof PolygresError.AmbiguousWrite) return error
  const code = errorCode(error)
  if (code !== "ROW_WRITE_OUTCOME_AMBIGUOUS" && code !== undefined && PolygresError.isCatalogCode(code)) return error
  const status = errorStatus(error)
  if (
    !(error instanceof PolygresError.Transport) &&
    !(error instanceof PolygresError.RequestTimeout) &&
    ![408, 500, 502, 503, 504].includes(status ?? -1)
  ) {
    return error
  }
  return new PolygresError.AmbiguousWrite({
    operation,
    message: PolygresError.redact(error.message),
    ...(status === undefined ? {} : { status }),
    code: code ?? "ROW_WRITE_OUTCOME_AMBIGUOUS",
    ...(error instanceof PolygresError.InvalidResponse || !("requestId" in error) || error.requestId === undefined
      ? {}
      : { requestId: error.requestId }),
    ...("retryAfterMillis" in error && error.retryAfterMillis !== undefined
      ? { retryAfterMillis: error.retryAfterMillis }
      : {}),
    details: "details" in error ? error.details : {},
  })
}

const expectedRowOperation = (mode: Rows.Mode): Rows.WriteResult["operation"] =>
  mode === "insert" ? "inserted" : mode === "upsert" ? "upserted" : "ignored"

const validateRowResponseIdentity = (
  operation: string,
  input: RowWriteInput,
  mode: Rows.Mode,
  result: Rows.WriteResult,
  expectedContextOperationId?: string,
): Effect.Effect<Rows.WriteResult, PolygresError.InvalidResponse> => {
  const context = Option.getOrUndefined(result.context)
  const echoedKey = Option.getOrUndefined(result.idempotencyKey)
  const mismatch =
    result.schema !== input.schema ||
    result.table !== input.table ||
    result.operation !== expectedRowOperation(mode) ||
    (echoedKey !== undefined && echoedKey !== input.idempotencyKey) ||
    isContextRequested(input) !== (context !== undefined) ||
    (input.contextCollectionId !== undefined && context?.collectionId !== input.contextCollectionId) ||
    (expectedContextOperationId !== undefined &&
      !Option.contains(context?.operationId ?? Option.none(), expectedContextOperationId))
  return mismatch
    ? Effect.fail(
        new PolygresError.InvalidResponse({
          operation,
          message: "Row write response identity did not match the request.",
          status: 200,
        }),
      )
    : Effect.succeed(result)
}

const validateRowValidationIdentity = (
  operation: string,
  input: Rows.ValidateInput,
  result: Rows.WriteValidation,
): Effect.Effect<Rows.WriteValidation, PolygresError.InvalidResponse> => {
  const context = Option.getOrUndefined(result.context)
  const mismatch =
    result.schema !== input.schema ||
    result.table !== input.table ||
    result.operation !== (input.mode ?? "insert") ||
    isContextRequested(input) !== (context !== undefined) ||
    (input.contextCollectionId !== undefined && context?.collectionId !== input.contextCollectionId)
  return mismatch
    ? Effect.fail(
        new PolygresError.InvalidResponse({
          operation,
          message: "Row validation response identity did not match the request.",
          status: 200,
        }),
      )
    : Effect.succeed(result)
}

const validateConfig = (options: Options) =>
  Effect.gen(function* () {
    const key = typeof options.apiKey === "string" ? options.apiKey : Redacted.value(options.apiKey)
    if (!/^poly_live_[0-9a-f]{32}$/.test(key)) {
      return yield* new PolygresError.Configuration({
        reason: "api-key",
        message: "API key must match poly_live_[32hex].",
      })
    }
    if (options.projectId !== undefined && !/^p[a-z0-9]{23}$/.test(options.projectId)) {
      return yield* new PolygresError.Configuration({
        reason: "project-id",
        message: "projectId must match ^p[a-z0-9]{23}$.",
      })
    }
    if (
      options.maxRetries !== undefined &&
      (!Number.isInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 5)
    ) {
      return yield* new PolygresError.Configuration({
        reason: "retries",
        message: "maxRetries must be an integer between 0 and 5.",
      })
    }
    if (options.projectMode !== undefined && options.projectMode !== "standard" && options.projectMode !== "synced") {
      return yield* new PolygresError.Configuration({
        reason: "project-mode",
        message: "projectMode must be standard or synced.",
      })
    }
    const runtimeUrl =
      options.runtimeUrl ??
      (options.projectId === undefined ? undefined : `https://${options.projectId}.api.db.polygres.com/v1`)
    if (runtimeUrl === undefined) {
      return yield* new PolygresError.Configuration({
        reason: "runtime-url",
        message: "runtimeUrl or projectId is required.",
      })
    }
    let url: URL
    try {
      url = new URL(runtimeUrl)
    } catch {
      return yield* new PolygresError.Configuration({
        reason: "runtime-url",
        message: "runtimeUrl must be a valid URL.",
      })
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return yield* new PolygresError.Configuration({
        reason: "runtime-url",
        message: "runtimeUrl must use HTTPS unless it targets localhost.",
      })
    }
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      return yield* new PolygresError.Configuration({
        reason: "runtime-url",
        message: "runtimeUrl must not contain credentials, query parameters, or a fragment.",
      })
    }
    const timeout = Duration.fromInput(options.timeout ?? "30 seconds")
    if (Option.isNone(timeout) || !Duration.isFinite(timeout.value) || Duration.toMillis(timeout.value) <= 0) {
      return yield* new PolygresError.Configuration({
        reason: "timeout",
        message: "timeout must be a finite positive duration.",
      })
    }
    const deadline = options.deadline === undefined ? Option.none() : Duration.fromInput(options.deadline)
    if (Option.isSome(deadline) && (!Duration.isFinite(deadline.value) || Duration.toMillis(deadline.value) <= 0)) {
      return yield* new PolygresError.Configuration({
        reason: "deadline",
        message: "deadline must be a finite positive duration.",
      })
    }
    return {
      apiKey: Redacted.make(key),
      baseUrl: url.toString().replace(/\/+$/, ""),
      timeout: timeout.value,
      deadline,
      maxRetries: options.maxRetries ?? 2,
      headers: Object.fromEntries(
        Object.entries(options.headers ?? {}).filter(([name]) => !protectedHeaders.has(name.toLowerCase())),
      ),
      apiVersion: API_VERSION,
      clientVersion: VERSION,
      projectMode: options.projectMode,
    }
  })

export const make = (options: Options): Effect.Effect<Service, PolygresError.Configuration, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const config = yield* validateConfig(options)
    const transport = yield* HttpTransport.make(config)
    const context = ContextClient.make(
      transport,
      Option.match(config.deadline, { onNone: () => ({}), onSome: (deadline) => ({ deadline }) }),
    )

    const withDeadline = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
      Option.match(config.deadline, {
        onNone: () => effect,
        onSome: (duration) =>
          effect.pipe(
            Effect.timeoutOrElse({
              duration,
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
          ),
      })

    const request = <A, B>(
      operation: string,
      path: string,
      wire: ResponseSchema<A>,
      domain: ResponseSchema<B>,
      map: (value: A) => B,
      body?: Readonly<Record<string, unknown>>,
    ): Effect.Effect<B, PolygresError.Request> =>
      withDeadline(
        operation,
        transport
          .request({
            operation,
            method: body === undefined ? "GET" : "POST",
            path,
            retry: "readOnly",
            ...(body === undefined ? {} : { body }),
          })
          .pipe(
            Effect.flatMap((payload) => Wire.decode(operation, wire, payload)),
            Effect.map(map),
            Effect.flatMap((value) => Wire.validate(operation, domain, value)),
          ),
      )

    const requestPage = <A, B>(
      operation: string,
      path: string,
      wire: ResponseSchema<A>,
      domain: ResponseSchema<B>,
      map: (value: A) => B,
      body: Readonly<Record<string, unknown>>,
    ) =>
      withDeadline(
        operation,
        transport
          .request({ operation, method: "POST", path, body, retry: "readOnly" })
          .pipe(Effect.flatMap((payload) => Wire.decodePage(operation, wire, domain, map, payload))),
      )

    const rowOperationWaiter = (expectedCollectionId: string) =>
      OperationWait.make<PolygresError.Request, never>((operationId, remaining) =>
        transport
          .requestWithMetadata({
            operation: "context.waitForOperation",
            method: "GET",
            path: `/context/operations/${encodeURIComponent(operationId)}`,
            retry: "readOnly",
            expectedStatuses: [200],
            timeout: remaining,
            budget: remaining,
          })
          .pipe(
            Effect.flatMap((response) =>
              Wire.decode("context.waitForOperation", RowsWire.ContextOperationEnvelope, response.payload).pipe(
                Effect.flatMap((envelope) =>
                  Wire.validate(
                    "context.waitForOperation",
                    Operation.Value,
                    RowsWire.contextOperation(envelope),
                    response.payload,
                  ).pipe(
                    Effect.flatMap((operation) => {
                      if (
                        operation.id !== operationId ||
                        operation.kind !== "points_upsert" ||
                        !Option.contains(operation.collectionId, expectedCollectionId)
                      ) {
                        return Effect.fail(
                          new PolygresError.InvalidResponse({
                            operation: "context.waitForOperation",
                            message: "Context operation identity did not match the pending row reconciliation.",
                            status: response.status,
                            requestId: PolygresError.redact(envelope.request_id),
                          }),
                        )
                      }
                      return Effect.succeed({
                        operation,
                        _tag: "PollResult" as const,
                        ...(response.retryAfterMillis === undefined
                          ? {}
                          : { retryAfterMillis: response.retryAfterMillis }),
                      })
                    }),
                  ),
                ),
              ),
            ),
          ),
      )

    const decodeRowResult = (
      operation: string,
      input: RowWriteInput,
      mode: Rows.Mode,
      payload: unknown,
      expectedContextOperationId?: string,
    ) =>
      Wire.decode(operation, RowsWire.WriteResult, payload).pipe(
        Effect.map(RowsWire.writeResult),
        Effect.flatMap((value) => Wire.validate(operation, RowsSchema.WriteResult, value, payload)),
        Effect.flatMap((value) =>
          validateRowResponseIdentity(operation, input, mode, value, expectedContextOperationId),
        ),
      )

    const sendRowOnce = (
      operation: string,
      input: RowWriteInput,
      mode: Rows.Mode,
      expectedContextOperationId?: string,
    ) =>
      transport
        .request({
          operation,
          method: "POST",
          path: rowPath(input),
          body: rowBody(input, mode),
          retry: "never",
          expectedStatuses: [200, 202],
          ...(input.idempotencyKey === undefined ? {} : { headers: { "Idempotency-Key": input.idempotencyKey } }),
        })
        .pipe(Effect.flatMap((payload) => decodeRowResult(operation, input, mode, payload, expectedContextOperationId)))

    const writeInitialRowOnce = (operation: string, input: RowWriteInput, mode: Rows.Mode) =>
      sendRowOnce(operation, input, mode).pipe(Effect.catch((error) => Effect.fail(ambiguousWrite(operation, error))))

    const finishRowWrite = (
      operation: string,
      input: RowWriteInput,
      mode: Rows.Mode,
      result: Rows.WriteResult,
    ): Effect.Effect<Rows.WriteResult, PolygresError.Write> => {
      if (input.waitForContext !== true || result.status !== "pending" || Option.isNone(result.context)) {
        return Effect.succeed(result)
      }
      const context = Option.getOrUndefined(result.context)
      if (context === undefined) return Effect.succeed(result)
      const operationId = Option.getOrUndefined(context.operationId)
      if (operationId === undefined) {
        return Effect.fail(
          new PolygresError.InvalidResponse({
            operation,
            message: "Pending Context reconciliation did not include an operation ID.",
            status: 200,
            requestId: result.requestId,
          }),
        )
      }
      const onWaitFailure = (
        error: PolygresError.Request | Operation.WaitError,
      ): Effect.Effect<Rows.WriteResult, PolygresError.Search> => {
        if (error instanceof Operation.TimedOut) return Effect.succeed(result)
        if (error instanceof Operation.InvalidWaitTimeout) {
          return invalidRowInput(operation, ["waitTimeout"], error.message)
        }
        const code = errorCode(error)
        if (code === "TIMEOUT" || (error instanceof PolygresError.RequestTimeout && error.kind === "deadline")) {
          return Effect.succeed(result)
        }
        const details = "details" in error ? error.details : {}
        const operationStatus = details.operation_status
        if (operationStatus !== "failed" && operationStatus !== "cancelled") {
          return Effect.fail(
            PolygresError.addDetails(error, {
              operation_id: operationId,
              idempotency_key: input.idempotencyKey,
              row_request_id: result.requestId,
            }),
          )
        }
        return Effect.succeed({
          ...result,
          status: "partial_failed",
          context: Option.some({
            ...context,
            status: "partial_failed",
            operationStatus: Option.some(operationStatus),
            error: Option.some({
              code: "ROW_CONTEXT_RECONCILIATION_FAILED",
              message: "The row committed, but Context reconciliation failed.",
              retryable: PolygresError.isRetryableContextError(code ?? "CONTEXT_OPERATION_FAILED"),
              details: {
                operation_id: operationId,
                underlying_code: code ?? "CONTEXT_OPERATION_FAILED",
              },
            }),
          }),
        })
      }
      const recovery = {
        operation_id: operationId,
        idempotency_key: input.idempotencyKey,
        row_request_id: result.requestId,
      }
      return rowOperationWaiter(context.collectionId)(operationId, {
        timeout: Duration.seconds(input.waitTimeout ?? 300),
      }).pipe(
        Effect.matchEffect({
          onFailure: onWaitFailure,
          onSuccess: () =>
            sendRowOnce(operation, input, mode, operationId).pipe(
              Effect.mapError((error) => PolygresError.addDetails(error, recovery)),
            ),
        }),
      )
    }

    const writeRow = <A extends RowWriteInput>(operation: string, schema: InputSchema<A>, mode: Rows.Mode, input: A) =>
      Effect.suspend(() => {
        let acknowledged: Rows.WriteResult | undefined
        return withDeadline(
          operation,
          parseInput(operation, schema, input).pipe(
            Effect.flatMap((parsed) => validateRowWrite(operation, parsed)),
            Effect.flatMap((parsed) =>
              writeInitialRowOnce(operation, parsed, mode).pipe(
                Effect.map((result) => {
                  acknowledged = result
                  return result
                }),
                Effect.flatMap((result) => finishRowWrite(operation, parsed, mode, result)),
              ),
            ),
          ),
        ).pipe(
          Effect.catch((error): Effect.Effect<never, PolygresError.Write> => {
            if (!(error instanceof PolygresError.RequestTimeout)) return Effect.fail(error)
            if (acknowledged === undefined) return Effect.fail(ambiguousWrite(operation, error))
            const context = Option.getOrUndefined(acknowledged.context)
            const operationId = context === undefined ? undefined : Option.getOrUndefined(context.operationId)
            return Effect.fail(
              PolygresError.addDetails(error, {
                ...(operationId === undefined ? {} : { operation_id: operationId }),
                idempotency_key: input.idempotencyKey,
                row_request_id: acknowledged.requestId,
              }),
            )
          }),
        )
      })

    const graphPage = <Input extends Graph.ExpandInput | Graph.NeighborhoodInput | Graph.RelatedInput>(
      operation: string,
      path: string,
      schema: InputSchema<Input>,
      defaults: { readonly maxDepth: number; readonly direction: Graph.Direction; readonly limit: number },
    ) =>
      Page.makeOperation<Input, Graph.Result>(
        Effect.fn(`Polygres.${operation}.page`)((input: Input) =>
          parseInput(operation, schema, input).pipe(
            Effect.flatMap((parsed) =>
              requestPage(
                operation,
                path,
                Wire.GraphResult,
                GraphSchema.Result,
                Wire.graphResult,
                graphSearchBody(parsed, defaults),
              ),
            ),
          ),
        ),
      )

    const vectorPage = <Input extends Vector.SearchInput | Vector.SimilarToInput>(
      operation: string,
      path: string,
      schema: InputSchema<Input>,
      identify: (input: Input) => Readonly<Record<string, unknown>>,
    ) =>
      Page.makeOperation<Input, Vector.Result>(
        Effect.fn(`Polygres.${operation}.page`)((input: Input) =>
          parseInput(operation, schema, input).pipe(
            Effect.flatMap((parsed) => validateVectorThresholds(operation, parsed)),
            Effect.flatMap((parsed) =>
              requestPage(operation, path, Wire.VectorResult, VectorSchema.Result, Wire.vectorResult, {
                ...identify(parsed),
                ...vectorBody(parsed),
              }),
            ),
          ),
        ),
      )

    const textPage = (operation: string, path: string) =>
      Page.makeOperation<Text.SearchInput, Text.Result>(
        Effect.fn(`Polygres.${operation}.page`)((input: Text.SearchInput) =>
          parseInput(operation, TextSchema.SearchInput, input).pipe(
            Effect.flatMap((parsed) =>
              requestPage(operation, path, Wire.TextResult, TextSchema.Result, Wire.textResult, {
                query: parsed.query,
                config: parsed.config,
                limit: parsed.limit ?? 10,
                filters: parsed.filters ?? {},
                cursor: parsed.cursor,
              }),
            ),
          ),
        ),
      )

    const hybridPage = <Input extends Hybrid.GraphFirstInput | Hybrid.VectorFirstInput | Hybrid.JointInput>(
      operation: string,
      path: string,
      schema: InputSchema<Input>,
      defaults: { readonly maxDepth: number; readonly limit: number; readonly vectorLimit?: number },
    ) =>
      Page.makeOperation<Input, Hybrid.Result>(
        Effect.fn(`Polygres.${operation}.page`)((input: Input) =>
          parseInput(operation, schema, input).pipe(
            Effect.flatMap((parsed) =>
              requestPage(
                operation,
                path,
                Wire.HybridResult,
                HybridSchema.Result,
                Wire.hybridResult,
                hybridBody(parsed, defaults),
              ),
            ),
          ),
        ),
      )

    const readiness = Effect.fn("Polygres.readiness")(function* () {
      return yield* request(
        "readiness",
        "/retrieval/readiness",
        Wire.Readiness,
        RuntimeSchema.Readiness,
        Wire.readiness,
      )
    })

    const connectionInfo = Effect.fn("Polygres.connectionInfo")(function* () {
      if (config.projectMode === "synced") {
        return yield* PolygresError.fromApi({
          operation: "connectionInfo",
          status: 403,
          code: "SYNCED_PROJECT_SURFACE_UNAVAILABLE",
        })
      }
      return yield* withDeadline(
        "connectionInfo",
        Effect.gen(function* () {
          const payload = yield* transport.request({
            operation: "connectionInfo",
            method: "GET",
            path: "/connection-info",
            retry: "readOnly",
            expectedStatuses: [200],
          })
          const value = yield* Wire.decode("connectionInfo", Wire.ConnectionInfo, payload)
          if (value.project_mode === "synced" || value.project?.project_mode === "synced") {
            return yield* PolygresError.fromApi({
              operation: "connectionInfo",
              status: 403,
              code: "SYNCED_PROJECT_SURFACE_UNAVAILABLE",
            })
          }
          return yield* Wire.validate(
            "connectionInfo",
            RuntimeSchema.ConnectionInfo,
            Wire.connectionInfo(value),
            payload,
          )
        }),
      )
    })

    return Client.of({
      readiness,
      connectionInfo,
      context,
      rows: {
        validate: Effect.fn("Polygres.rows.validate")((input: Rows.ValidateInput) =>
          parseInput("rows.validate", RowsSchema.ValidateInput, input).pipe(
            Effect.flatMap((parsed) => validateRowMode("rows.validate", parsed)),
            Effect.flatMap((parsed) =>
              withDeadline(
                "rows.validate",
                transport
                  .request({
                    operation: "rows.validate",
                    method: "POST",
                    path: rowPath(parsed, true),
                    body: rowBody(parsed, parsed.mode),
                    retry: "readOnly",
                  })
                  .pipe(
                    Effect.flatMap((payload) =>
                      Wire.decode("rows.validate", RowsWire.WriteValidation, payload).pipe(
                        Effect.map(RowsWire.writeValidation),
                        Effect.flatMap((value) =>
                          Wire.validate("rows.validate", RowsSchema.WriteValidation, value, payload),
                        ),
                        Effect.flatMap((value) => validateRowValidationIdentity("rows.validate", parsed, value)),
                      ),
                    ),
                  ),
              ),
            ),
          ),
        ),
        insert: Effect.fn("Polygres.rows.insert")((input: Rows.InsertInput) =>
          writeRow("rows.insert", RowsSchema.InsertInput, "insert", input),
        ),
        upsert: Effect.fn("Polygres.rows.upsert")((input: Rows.UpsertInput) =>
          writeRow("rows.upsert", RowsSchema.UpsertInput, "upsert", input),
        ),
        ignore: Effect.fn("Polygres.rows.ignore")((input: Rows.IgnoreInput) =>
          writeRow("rows.ignore", RowsSchema.IgnoreInput, "ignore", input),
        ),
      },
      graph: {
        expand: graphPage("graph.expand", "/graph/expand", GraphSchema.ExpandInput, {
          maxDepth: 5,
          direction: "out",
          limit: 50,
        }),
        neighborhood: graphPage("graph.neighborhood", "/graph/neighborhood", GraphSchema.NeighborhoodInput, {
          maxDepth: 2,
          direction: "any",
          limit: 100,
        }),
        related: graphPage("graph.related", "/graph/related", GraphSchema.RelatedInput, {
          maxDepth: 1,
          direction: "any",
          limit: 20,
        }),
        path: Effect.fn("Polygres.graph.path")((input: Graph.PathInput) =>
          parseInput("graph.path", GraphSchema.PathInput, input).pipe(
            Effect.flatMap((parsed) =>
              withDeadline(
                "graph.path",
                transport
                  .request({
                    operation: "graph.path",
                    method: "POST",
                    path: "/graph/path",
                    retry: "readOnly",
                    body: {
                      source: parsed.source,
                      target: parsed.target,
                      ...traversalBody(parsed, { maxDepth: 5, direction: "any" }),
                    },
                  })
                  .pipe(
                    Effect.flatMap((payload) =>
                      Wire.decode("graph.path", Wire.GraphPathResponse, payload).pipe(
                        Effect.map((value) => Wire.graphPathResponse(value, payload)),
                        Effect.flatMap((value) =>
                          Wire.validate("graph.path", GraphSchema.PathResponse, value, payload),
                        ),
                      ),
                    ),
                  ),
              ),
            ),
          ),
        ),
        connection: Effect.fn("Polygres.graph.connection")((input: Graph.ConnectionInput) =>
          parseInput("graph.connection", GraphSchema.ConnectionInput, input).pipe(
            Effect.flatMap((parsed) =>
              withDeadline(
                "graph.connection",
                transport
                  .request({
                    operation: "graph.connection",
                    method: "POST",
                    path: "/graph/connection",
                    retry: "readOnly",
                    body: {
                      entities: parsed.entities,
                      ...traversalBody(parsed, { maxDepth: 5, direction: "any" }),
                    },
                  })
                  .pipe(
                    Effect.flatMap((payload) =>
                      Wire.decode("graph.connection", Wire.GraphConnectionResponse, payload).pipe(
                        Effect.map((value) => Wire.graphConnectionResponse(value, payload)),
                        Effect.flatMap((value) =>
                          Wire.validate("graph.connection", GraphSchema.ConnectionResponse, value, payload),
                        ),
                      ),
                    ),
                  ),
              ),
            ),
          ),
        ),
      },
      vector: {
        search: vectorPage("vector.search", "/vector/search", VectorSchema.SearchInput, (input) => ({
          embedding: input.embedding,
        })),
        similarTo: vectorPage("vector.similarTo", "/vector/similar-to", VectorSchema.SimilarToInput, (input) => ({
          row_id: input.rowId,
        })),
      },
      text: {
        tsvector: textPage("text.tsvector", "/text/tsvector"),
        fuzzy: textPage("text.fuzzy", "/text/fuzzy"),
      },
      hybrid: {
        graphFirst: hybridPage("hybrid.graphFirst", "/hybrid/graph-first", HybridSchema.GraphFirstInput, {
          maxDepth: 2,
          limit: 10,
        }),
        vectorFirst: hybridPage("hybrid.vectorFirst", "/hybrid/vector-first", HybridSchema.VectorFirstInput, {
          maxDepth: 1,
          limit: 10,
          vectorLimit: 20,
        }),
        joint: hybridPage("hybrid.joint", "/hybrid/joint", HybridSchema.JointInput, {
          maxDepth: 2,
          limit: 10,
          vectorLimit: 20,
        }),
      },
    })
  })

export const layer = (options: Options): Layer.Layer<Client, PolygresError.Configuration, HttpClient.HttpClient> =>
  Layer.effect(Client, make(options))

export const fromEnv = (env: Readonly<Record<string, string | undefined>>): Options => ({
  apiKey: Redacted.make(env.POLY_API_KEY ?? ""),
  ...(env.POLY_PROJECT_ID === undefined ? {} : { projectId: env.POLY_PROJECT_ID }),
  ...(env.POLY_RUNTIME_URL === undefined || env.POLY_RUNTIME_URL === "" ? {} : { runtimeUrl: env.POLY_RUNTIME_URL }),
})
