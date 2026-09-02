import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"

import { Polygres } from "../src/index.js"

const apiKey = process.env.POLY_API_KEY ?? ""
const projectId = process.env.POLY_PROJECT_ID
const runtimeUrl = process.env.POLY_RUNTIME_URL || undefined

const program = Effect.gen(function* () {
  const client = yield* Polygres.make({
    apiKey: Redacted.make(apiKey),
    ...(projectId === undefined ? {} : { projectId }),
    ...(runtimeUrl === undefined ? {} : { runtimeUrl }),
  })
  const capabilities = yield* client.context.getCapabilities({})
  console.log(
    JSON.stringify(
      {
        contractVersion: capabilities.contractVersion,
        productStatus: capabilities.productStatus,
        setup: capabilities.setup,
        denseSearch: capabilities.denseSearch,
        pointScroll: capabilities.pointScroll,
        count: capabilities.count,
        facets: capabilities.facets,
        groupedSearch: capabilities.groupedSearch,
        recallCheck: capabilities.recallCheck,
        textHybrid: capabilities.textHybrid,
        graphFirst: capabilities.graphFirst,
        vectorFirst: capabilities.vectorFirst,
        rankFusion: capabilities.rankFusion,
        joint: capabilities.joint,
        maxDimensions: capabilities.maxDimensions,
        maxSearchLimit: capabilities.maxSearchLimit,
      },
      null,
      2,
    ),
  )
})

await program.pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise)
