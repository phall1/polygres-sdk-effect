import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import type { HttpClient } from "effect/unstable/http"

import type * as Graph from "./Graph.js"
import * as GraphSchema from "./Graph.js"
import type * as Hybrid from "./Hybrid.js"
import * as HybridSchema from "./Hybrid.js"
import * as HttpTransport from "./internal/HttpTransport.js"
import * as Wire from "./internal/Wire.js"
import * as Page from "./Page.js"
import * as PolygresError from "./PolygresError.js"
import type * as Runtime from "./Runtime.js"
import * as RuntimeSchema from "./Runtime.js"
import type * as Text from "./Text.js"
import * as TextSchema from "./Text.js"
import type * as Vector from "./Vector.js"
import * as VectorSchema from "./Vector.js"

export const VERSION = "0.1.0"
export const API_VERSION = "2026-08-04"

const protectedHeaders = new Set(["authorization", "user-agent", "x-polygres-api-version", "x-polygres-client-info"])

export interface Options {
  readonly apiKey: Redacted.Redacted<string> | string
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

export interface Service {
  readonly readiness: () => Effect.Effect<Runtime.Readiness, PolygresError.Request>
  readonly connectionInfo: () => Effect.Effect<Runtime.ConnectionInfo, PolygresError.Request>
  readonly graph: GraphService
  readonly vector: VectorService
  readonly text: TextService
  readonly hybrid: HybridService
}

export class Client extends Context.Service<Client, Service>()("polygres-sdk-effect/Polygres") {}

type InputSchema<A> = Schema.Schema<A> & { readonly DecodingServices: never }
type ResponseSchema<A> = Schema.Schema<A> & { readonly DecodingServices: never }

const parseInput = <A>(operation: string, schema: InputSchema<A>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
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
            retry: "read",
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
          .request({ operation, method: "POST", path, body, retry: "read" })
          .pipe(Effect.flatMap((payload) => Wire.decodePage(operation, wire, domain, map, payload))),
      )

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
            retry: "read",
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
                    retry: "read",
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
                    retry: "read",
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
