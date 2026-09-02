import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"

import { make } from "../src/index.js"

const apiKey = process.env.POLY_API_KEY ?? ""
const projectId = process.env.POLY_PROJECT_ID
const runtimeUrl = process.env.POLY_RUNTIME_URL || undefined

const program = Effect.gen(function* () {
  const client = yield* make({
    apiKey: Redacted.make(apiKey),
    ...(projectId === undefined ? {} : { projectId }),
    ...(runtimeUrl === undefined ? {} : { runtimeUrl }),
  })
  const readiness = yield* client.readiness()
  console.log(
    JSON.stringify(
      {
        projectId: readiness.project_id,
        requestId: readiness.request_id,
        graph: readiness.graph.ready,
        vector: readiness.vector.ready,
        hybrid: readiness.hybrid.ready,
      },
      null,
      2,
    ),
  )
})

await program.pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise)
