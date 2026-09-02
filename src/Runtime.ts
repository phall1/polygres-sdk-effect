import { Schema } from "effect"

import { JsonObject } from "./Entity.js"

export const ReadinessState = Schema.Struct({
  ready: Schema.Boolean,
  defaultConfig: Schema.Option(Schema.String),
}).pipe(Schema.annotate({ identifier: "Polygres.Runtime.ReadinessState" }))
export interface ReadinessState extends Schema.Schema.Type<typeof ReadinessState> {}

export const Readiness = Schema.Struct({
  projectId: Schema.String,
  graph: ReadinessState,
  vector: ReadinessState,
  hybrid: ReadinessState,
  requestId: Schema.Option(Schema.String),
  metadata: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Runtime.Readiness" }))
export interface Readiness extends Schema.Schema.Type<typeof Readiness> {}

export const ConnectionEndpoint = Schema.Struct({
  host: Schema.String,
  urlWithoutPassword: Schema.String,
}).pipe(Schema.annotate({ identifier: "Polygres.Runtime.ConnectionEndpoint" }))
export interface ConnectionEndpoint extends Schema.Schema.Type<typeof ConnectionEndpoint> {}

export const ConnectionInfo = Schema.Struct({
  projectId: Schema.String,
  projectMode: Schema.Option(Schema.String),
  database: Schema.String,
  username: Schema.String,
  port: Schema.Int,
  direct: ConnectionEndpoint,
  pooled: ConnectionEndpoint,
  requestId: Schema.Option(Schema.String),
  metadata: JsonObject,
}).pipe(Schema.annotate({ identifier: "Polygres.Runtime.ConnectionInfo" }))
export interface ConnectionInfo extends Schema.Schema.Type<typeof ConnectionInfo> {}
