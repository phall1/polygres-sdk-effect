# polygres-sdk-effect

[![CI](https://github.com/phall1/polygres-sdk-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/phall1/polygres-sdk-effect/actions/workflows/ci.yml)

Effect-native TypeScript SDK for the [Polygres](https://polygres.com) Runtime API.

This independent package is designed as an upstreamable production SDK. It uses Effect services, Layers, Schema, tagged errors, and Stream directly; applications provide the HTTP transport.

## Install

```sh
bun add polygres-sdk-effect effect@4.0.0-rc.112
```

## Usage

```ts
import { Effect, Redacted, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Polygres, PolygresError } from "polygres-sdk-effect"

const PolygresLive = Polygres.layer({
  apiKey: Redacted.make(process.env.POLY_API_KEY!),
  projectId: "p0123456789abcdef0123456",
})

const program = Effect.gen(function* () {
  const polygres = yield* Polygres.Client
  const readiness = yield* polygres.readiness()

  const firstPage = yield* polygres.text.tsvector.page({
    query: "intrusion campaign",
    config: "evidence_body",
    limit: 50,
  })

  const topHundred = yield* polygres.vector.search
    .stream({
      embedding: [0.1, 0.2],
      config: "evidence_embeddings",
      minSimilarity: 0.8,
      limit: 50,
    })
    .pipe(Stream.take(100), Stream.runCollect)

  return { readiness, firstPage, topHundred }
}).pipe(
  Effect.catchTag("Polygres.RateLimited", (error) =>
    Effect.logWarning("Polygres rate limited the request", { requestId: error.requestId }),
  ),
  Effect.provide(PolygresLive),
  Effect.provide(FetchHttpClient.layer),
)

await Effect.runPromise(program)
```

`Polygres.make(options)` constructs a client directly and retains `HttpClient.HttpClient` in its requirement channel. `Polygres.layer(options)` provides the yieldable `Polygres.Client` service while preserving that same transport requirement.

## API Shape

- Nullary Runtime methods: `polygres.readiness()` and `polygres.connectionInfo()`.
- Object inputs: `polygres.graph.path({ source, target, maxDepth: 5 })`.
- Paginated reads: `polygres.vector.search.page(input)`.
- Cold auto-pagination: `polygres.vector.search.stream(inputWithoutCursor)`.
- Domain schemas and types: `Runtime.Readiness`, `Graph.PathInput`, `Vector.Result`, and peers.
- Narrow errors: construction returns `PolygresError.Configuration`; retrieval returns `PolygresError.Request | PolygresError.InvalidInput`.
- CamelCase public models with Runtime wire names confined to private adapters.
- `Option` for nullable cursors, request IDs, and ranking fields.

`timeout` limits each HTTP attempt independently. Set `deadline` when the complete operation, including retries, backoff, response reading, and schema adaptation, must share one time budget. Both options accept Effect `Duration.Input` values.

The stable retrieval surface contains readiness and passwordless connection metadata plus graph, vector, PostgreSQL text, and hybrid retrieval. Row writes and pgContext administration remain deferred until their idempotency, ambiguous-write, and operation-wait semantics have dedicated contracts.

See [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Contract Updates

```sh
bun run contracts:refresh -- check
bun run contracts:refresh -- update --format prompt
```

The updater downloads exact canonical artifacts from one immutable official upstream commit, validates linked request/response schemas, and emits stable JSON or a task suitable for any coding agent. It never executes upstream code or rewrites the SDK automatically. See [`docs/CONTRACT_REFRESH.md`](docs/CONTRACT_REFRESH.md).

## Development

```sh
bun install
bun run check
```

For a secret-safe live readiness check, set `POLY_API_KEY` and either `POLY_PROJECT_ID` or `POLY_RUNTIME_URL`, then run `bun run live:readiness`.

Never commit Project API keys or PostgreSQL passwords.
