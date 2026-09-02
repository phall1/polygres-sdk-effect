import { Context, Duration, Effect, Layer, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"

import {
  apiError,
  PolygresConfigError,
  PolygresDecodeError,
  type PolygresError,
  PolygresTransportError,
  redact,
} from "./errors.js"
import {
  ConnectionInfo,
  GraphConnectionResponse,
  type GraphOptions,
  GraphPathResponse,
  GraphResult,
  type HybridOptions,
  HybridResult,
  type NodeRef,
  Page,
  type ResultPage,
  RetrievalReadiness,
  type TextOptions,
  TextResult,
  type VectorOptions,
  VectorResult,
} from "./schemas.js"

export const VERSION = "0.1.0"
export const API_VERSION = "2026-08-04"

const retryStatuses = new Set([408, 429, 500, 502, 503, 504])
const maintenanceCodes = new Set(["MAINTENANCE_FULL", "MAINTENANCE_READ_ONLY"])
const protectedHeaders = new Set(["authorization", "user-agent", "x-polygres-api-version", "x-polygres-client-info"])

export interface Options {
  readonly apiKey: Redacted.Redacted<string> | string
  readonly projectId?: string
  readonly projectMode?: "standard" | "synced"
  readonly runtimeUrl?: string
  readonly timeout?: Duration.Input
  readonly maxRetries?: number
  readonly headers?: Readonly<Record<string, string>>
}

export interface Interface {
  readonly readiness: () => Effect.Effect<RetrievalReadiness, PolygresError>
  readonly connectionInfo: () => Effect.Effect<ConnectionInfo, PolygresError>
  readonly graph: {
    readonly expand: (
      start: NodeRef | ReadonlyArray<NodeRef>,
      options?: GraphOptions,
    ) => Effect.Effect<ResultPage<GraphResult>, PolygresError>
    readonly neighborhood: (
      start: NodeRef,
      options?: GraphOptions,
    ) => Effect.Effect<ResultPage<GraphResult>, PolygresError>
    readonly related: (start: NodeRef, options?: GraphOptions) => Effect.Effect<ResultPage<GraphResult>, PolygresError>
    readonly path: (
      source: NodeRef,
      target: NodeRef,
      options?: Pick<GraphOptions, "maxDepth" | "relationshipTypes" | "direction">,
    ) => Effect.Effect<GraphPathResponse, PolygresError>
    readonly connection: (
      entities: ReadonlyArray<NodeRef>,
      options?: Pick<GraphOptions, "maxDepth" | "relationshipTypes" | "direction">,
    ) => Effect.Effect<GraphConnectionResponse, PolygresError>
  }
  readonly vector: {
    readonly search: (
      embedding: ReadonlyArray<number>,
      options?: VectorOptions,
    ) => Effect.Effect<ResultPage<VectorResult>, PolygresError>
    readonly similarTo: (
      rowId: string,
      options?: VectorOptions,
    ) => Effect.Effect<ResultPage<VectorResult>, PolygresError>
  }
  readonly text: {
    readonly tsvector: (query: string, options: TextOptions) => Effect.Effect<ResultPage<TextResult>, PolygresError>
    readonly fuzzy: (query: string, options: TextOptions) => Effect.Effect<ResultPage<TextResult>, PolygresError>
  }
  readonly hybrid: {
    readonly graphFirst: (
      start: NodeRef,
      embedding: ReadonlyArray<number>,
      options?: HybridOptions,
    ) => Effect.Effect<ResultPage<HybridResult>, PolygresError>
    readonly vectorFirst: (
      embedding: ReadonlyArray<number>,
      options?: HybridOptions & { readonly start?: NodeRef },
    ) => Effect.Effect<ResultPage<HybridResult>, PolygresError>
    readonly joint: (
      embedding: ReadonlyArray<number>,
      start: NodeRef,
      options?: HybridOptions,
    ) => Effect.Effect<ResultPage<HybridResult>, PolygresError>
  }
}

export class PolygresClient extends Context.Service<PolygresClient, Interface>()(
  "polygres-sdk-effect/PolygresClient",
) {}

const ApiFailure = Schema.Struct({
  request_id: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      message: Schema.optionalKey(Schema.String),
      details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      variant: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
})

type Method = "GET" | "POST"
type ResponseSchema<A> = Schema.Schema<A> & { readonly DecodingServices: never }

const configError = (reason: PolygresConfigError["reason"], message: string) =>
  new PolygresConfigError({ reason, message })

const compact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(compact)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null)
        .map(([key, item]) => [key, compact(item)]),
    )
  }
  return value
}

const validateOptions = (options: Options) =>
  Effect.gen(function* () {
    const key = typeof options.apiKey === "string" ? options.apiKey : Redacted.value(options.apiKey)
    if (!/^poly_live_[0-9a-f]{32}$/.test(key)) {
      return yield* configError("api-key", "API key must match poly_live_[32hex]")
    }
    if (
      options.maxRetries !== undefined &&
      (!Number.isInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 5)
    ) {
      return yield* configError("retries", "maxRetries must be an integer between 0 and 5")
    }
    const runtimeUrl =
      options.runtimeUrl ??
      (options.projectId === undefined ? undefined : `https://${options.projectId}.api.db.polygres.com/v1`)
    if (runtimeUrl === undefined) {
      return yield* configError("runtime-url", "runtimeUrl or projectId is required")
    }
    if (options.projectId !== undefined && !/^p[a-z0-9]{23}$/.test(options.projectId)) {
      return yield* configError("runtime-url", "projectId must match ^p[a-z0-9]{23}$")
    }
    let url: URL
    try {
      url = new URL(runtimeUrl)
    } catch {
      return yield* configError("runtime-url", "runtimeUrl must be a valid URL")
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return yield* configError("runtime-url", "runtimeUrl must use HTTPS unless it targets localhost")
    }
    return {
      key: Redacted.make(key),
      runtimeUrl: runtimeUrl.replace(/\/+$/, ""),
      timeout: options.timeout ?? "30 seconds",
      maxRetries: options.maxRetries ?? 2,
      headers: Object.fromEntries(
        Object.entries(options.headers ?? {}).filter(([name]) => !protectedHeaders.has(name.toLowerCase())),
      ),
      projectMode: options.projectMode,
    }
  })

const requestHeaders = (key: Redacted.Redacted<string>, custom: Readonly<Record<string, string>>) => ({
  ...custom,
  authorization: `Bearer ${Redacted.value(key)}`,
  "user-agent": `polygres-effect/${VERSION}`,
  "x-polygres-client-info": `polygres-effect/${VERSION}; runtime/effect-http`,
  "x-polygres-api-version": API_VERSION,
})

const validateEmbedding = (embedding: ReadonlyArray<number>) =>
  embedding.length > 0 && embedding.every(Number.isFinite)
    ? Effect.void
    : Effect.fail(configError("embedding", "embedding must contain finite numbers"))

const validateLimit = (name: string, value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max
    ? Effect.void
    : Effect.fail(configError("limit", `${name} must be an integer between ${min} and ${max}`))

const validateGraphOptions = (options: GraphOptions, defaults: { readonly depth: number; readonly limit: number }) =>
  Effect.all([
    validateLimit("maxDepth", options.maxDepth ?? defaults.depth, 1, 20),
    validateLimit("limit", options.limit ?? defaults.limit, 1, 1000),
  ])

const validateVectorOptions = (options: VectorOptions) => {
  if (options.maxDistance !== undefined && options.minSimilarity !== undefined) {
    return Effect.fail(configError("input", "maxDistance and minSimilarity are mutually exclusive"))
  }
  return options.limit === undefined ? Effect.void : validateLimit("limit", options.limit, 1, 1000)
}

const validateTextOptions = (query: string, options: TextOptions) => {
  if (query.trim().length === 0) return Effect.fail(configError("input", "query is required"))
  if (options.config.trim().length === 0) return Effect.fail(configError("input", "config is required"))
  return validateLimit("limit", options.limit ?? 10, 1, 1000)
}

const retryDelay = (header: string | undefined, attempt: number): number => {
  if (header !== undefined) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
    const date = Date.parse(header)
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }
  return 25 * 2 ** attempt + Math.random() * 5
}

export const make = (options: Options): Effect.Effect<Interface, PolygresConfigError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const config = yield* validateOptions(options)
    const baseHttp = yield* HttpClient.HttpClient
    const execute = <A>(
      method: Method,
      path: string,
      responseSchema: ResponseSchema<A>,
      body?: unknown,
    ): Effect.Effect<A, PolygresError> =>
      Effect.gen(function* () {
        const initial =
          method === "GET"
            ? HttpClientRequest.get(`${config.runtimeUrl}${path}`)
            : HttpClientRequest.post(`${config.runtimeUrl}${path}`)
        const request = (body === undefined ? initial : HttpClientRequest.bodyJsonUnsafe(initial, compact(body))).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeaders(requestHeaders(config.key, config.headers)),
        )
        type ResponsePayload = {
          readonly response: HttpClientResponse.HttpClientResponse
          readonly payload: unknown
        }
        const send = (
          attempt: number,
        ): Effect.Effect<ResponsePayload, PolygresTransportError | PolygresDecodeError> => {
          const once = baseHttp.execute(request).pipe(
            Effect.mapError(
              () =>
                new PolygresTransportError({
                  reason: "network",
                  message: `Polygres ${method} ${path} could not reach the Runtime`,
                }),
            ),
            Effect.flatMap((response) =>
              response.json.pipe(
                Effect.map((payload) => ({ response, payload })),
                Effect.mapError(
                  () =>
                    new PolygresDecodeError({
                      message: `Polygres ${method} ${path} returned invalid JSON`,
                      status: response.status,
                    }),
                ),
              ),
            ),
          )
          return Effect.matchEffect(once, {
            onFailure: (error) => {
              if (attempt >= config.maxRetries) return Effect.fail(error)
              if (error instanceof PolygresDecodeError && !retryStatuses.has(error.status)) return Effect.fail(error)
              return Effect.sleep(Duration.millis(retryDelay(undefined, attempt))).pipe(
                Effect.andThen(send(attempt + 1)),
              )
            },
            onSuccess: ({ response, payload }) => {
              const code =
                typeof payload === "object" &&
                payload !== null &&
                typeof (payload as { error?: { code?: unknown } }).error?.code === "string"
                  ? (payload as { error: { code: string } }).error.code
                  : undefined
              if (
                attempt < config.maxRetries &&
                retryStatuses.has(response.status) &&
                !maintenanceCodes.has(code ?? "")
              ) {
                const delay = retryDelay(response.headers["retry-after"], attempt)
                return Effect.sleep(Duration.millis(delay)).pipe(Effect.andThen(send(attempt + 1)))
              }
              return Effect.succeed({ response, payload })
            },
          })
        }
        const { response, payload } = yield* send(0).pipe(
          Effect.timeoutOrElse({
            duration: config.timeout,
            orElse: () =>
              Effect.fail(
                new PolygresTransportError({
                  reason: "timeout",
                  message: `Polygres ${method} ${path} timed out`,
                }),
              ),
          }),
        )
        if (response.status < 200 || response.status >= 300) {
          const parsed = yield* Schema.decodeUnknownEffect(ApiFailure)(payload).pipe(Effect.option)
          const failure = parsed._tag === "Some" ? parsed.value : undefined
          return yield* apiError({
            status: response.status,
            message: redact(failure?.error?.message ?? `Polygres request failed with HTTP ${response.status}`),
            ...(failure?.error?.code === undefined ? {} : { code: failure.error.code }),
            ...(failure?.request_id === undefined ? {} : { requestId: failure.request_id }),
            details: failure?.error?.details ?? {},
          })
        }
        return yield* Schema.decodeUnknownEffect(responseSchema)(payload).pipe(
          Effect.mapError(
            (cause) =>
              new PolygresDecodeError({
                message: redact(`Polygres ${method} ${path} returned an invalid response: ${String(cause)}`),
                status: response.status,
                ...(typeof (payload as { request_id?: unknown })?.request_id === "string"
                  ? { requestId: (payload as { request_id: string }).request_id }
                  : {}),
              }),
          ),
        )
      }).pipe(Effect.withSpan(`Polygres ${method} ${path}`))

    const page = <A>(schema: ResponseSchema<A>, method: Method, path: string, body: unknown) =>
      execute(method, path, Page(schema), body).pipe(
        Effect.map(
          (result): ResultPage<A> => ({
            results: result.results,
            nextCursor: result.next_cursor,
            hasMore: result.has_more,
            ...(result.request_id === undefined ? {} : { requestId: result.request_id }),
          }),
        ),
      )

    const graphBody = (options: GraphOptions = {}) => ({
      max_depth: options.maxDepth,
      relationship_types: options.relationshipTypes,
      direction: options.direction === "both" ? "any" : options.direction,
      filters: options.filters ?? {},
      target_table: options.targetTable,
      limit: options.limit,
      cursor: options.cursor,
    })
    const vectorBody = (options: VectorOptions = {}) => ({
      config: options.config,
      limit: options.limit,
      filters: options.filters ?? {},
      max_distance: options.maxDistance,
      min_similarity: options.minSimilarity,
      include_values: options.includeValues ?? false,
      cursor: options.cursor,
    })
    const hybridBody = (options: HybridOptions = {}) => ({
      ...graphBody(options),
      config: options.config,
      vector_limit: options.vectorLimit,
      weights: {
        vector: options.vectorWeight ?? 0.7,
        graph: options.graphWeight ?? 0.3,
      },
    })

    return PolygresClient.of({
      readiness: () => execute("GET", "/retrieval/readiness", RetrievalReadiness),
      connectionInfo: () =>
        config.projectMode === "synced"
          ? Effect.fail(
              apiError({
                status: 403,
                code: "SYNCED_PROJECT_SURFACE_UNAVAILABLE",
                message: "Connection information is unavailable for synchronized projects.",
              }),
            )
          : execute("GET", "/connection-info", ConnectionInfo).pipe(
              Effect.flatMap((info) =>
                info.project_mode === "synced"
                  ? Effect.fail(
                      apiError({
                        status: 403,
                        code: "SYNCED_PROJECT_SURFACE_UNAVAILABLE",
                        message: "Connection information is unavailable for synchronized projects.",
                      }),
                    )
                  : Effect.succeed(info),
              ),
            ),
      graph: {
        expand: (start, options = {}) => {
          const limit = options.limit ?? 50
          return validateGraphOptions(options, { depth: 5, limit }).pipe(
            Effect.andThen(
              page(GraphResult, "POST", "/graph/expand", {
                start,
                ...graphBody({
                  ...options,
                  maxDepth: options.maxDepth ?? 5,
                  direction: options.direction ?? "out",
                  limit,
                }),
              }),
            ),
          )
        },
        neighborhood: (start, options = {}) => {
          const limit = options.limit ?? 100
          return validateGraphOptions(options, { depth: 2, limit }).pipe(
            Effect.andThen(
              page(GraphResult, "POST", "/graph/neighborhood", {
                start,
                ...graphBody({
                  ...options,
                  maxDepth: options.maxDepth ?? 2,
                  direction: options.direction ?? "any",
                  limit,
                }),
              }),
            ),
          )
        },
        related: (start, options = {}) => {
          const limit = options.limit ?? 20
          return validateGraphOptions({ ...options, maxDepth: 1 }, { depth: 1, limit }).pipe(
            Effect.andThen(
              page(GraphResult, "POST", "/graph/related", {
                start,
                ...graphBody({ ...options, maxDepth: 1, direction: options.direction ?? "any", limit }),
              }),
            ),
          )
        },
        path: (source, target, options = {}) =>
          execute("POST", "/graph/path", GraphPathResponse, {
            source,
            target,
            ...graphBody({ ...options, maxDepth: options.maxDepth ?? 5, direction: options.direction ?? "any" }),
          }),
        connection: (entities, options = {}) =>
          entities.length < 2 || entities.length > 10
            ? Effect.fail(configError("input", "entities must contain 2 to 10 items"))
            : execute("POST", "/graph/connection", GraphConnectionResponse, {
                entities,
                ...graphBody({ ...options, maxDepth: options.maxDepth ?? 5, direction: options.direction ?? "any" }),
              }),
      },
      vector: {
        search: (embedding, options = {}) =>
          Effect.all([validateEmbedding(embedding), validateVectorOptions(options)]).pipe(
            Effect.andThen(
              page(VectorResult, "POST", "/vector/search", {
                embedding,
                ...vectorBody(options),
              }),
            ),
          ),
        similarTo: (rowId, options = {}) =>
          rowId.length === 0
            ? Effect.fail(configError("input", "rowId is required"))
            : validateVectorOptions(options).pipe(
                Effect.andThen(
                  page(VectorResult, "POST", "/vector/similar-to", {
                    row_id: rowId,
                    ...vectorBody(options),
                  }),
                ),
              ),
      },
      text: {
        tsvector: (query, options) =>
          validateTextOptions(query, options).pipe(
            Effect.andThen(
              page(TextResult, "POST", "/text/tsvector", {
                query,
                config: options.config,
                limit: options.limit ?? 10,
                filters: options.filters ?? {},
                cursor: options.cursor,
              }),
            ),
          ),
        fuzzy: (query, options) =>
          validateTextOptions(query, options).pipe(
            Effect.andThen(
              page(TextResult, "POST", "/text/fuzzy", {
                query,
                config: options.config,
                limit: options.limit ?? 10,
                filters: options.filters ?? {},
                cursor: options.cursor,
              }),
            ),
          ),
      },
      hybrid: {
        graphFirst: (start, embedding, options = {}) =>
          validateEmbedding(embedding).pipe(
            Effect.andThen(
              page(HybridResult, "POST", "/hybrid/graph-first", {
                start,
                embedding,
                ...hybridBody({ ...options, maxDepth: options.maxDepth ?? 2, limit: options.limit ?? 10 }),
              }),
            ),
          ),
        vectorFirst: (embedding, options = {}) =>
          validateEmbedding(embedding).pipe(
            Effect.andThen(
              page(HybridResult, "POST", "/hybrid/vector-first", {
                embedding,
                start: options.start,
                ...hybridBody({
                  ...options,
                  maxDepth: options.maxDepth ?? 1,
                  vectorLimit: options.vectorLimit ?? 20,
                  limit: options.limit ?? 10,
                }),
              }),
            ),
          ),
        joint: (embedding, start, options = {}) =>
          validateEmbedding(embedding).pipe(
            Effect.andThen(
              page(HybridResult, "POST", "/hybrid/joint", {
                embedding,
                start,
                ...hybridBody({
                  ...options,
                  maxDepth: options.maxDepth ?? 2,
                  vectorLimit: options.vectorLimit ?? 20,
                  limit: options.limit ?? 10,
                }),
              }),
            ),
          ),
      },
    })
  })

export const layer = (options: Options): Layer.Layer<PolygresClient, PolygresConfigError, HttpClient.HttpClient> =>
  Layer.effect(PolygresClient, make(options))

export const fromEnv = (env: Readonly<Record<string, string | undefined>>): Options => ({
  apiKey: Redacted.make(env.POLY_API_KEY ?? ""),
  ...(env.POLY_PROJECT_ID === undefined ? {} : { projectId: env.POLY_PROJECT_ID }),
  ...(env.POLY_RUNTIME_URL === undefined || env.POLY_RUNTIME_URL === "" ? {} : { runtimeUrl: env.POLY_RUNTIME_URL }),
})
