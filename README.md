# polygres-sdk-effect

[![CI](https://github.com/phall1/polygres-sdk-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/phall1/polygres-sdk-effect/actions/workflows/ci.yml)

Effect-native TypeScript SDK for the [Polygres](https://polygres.com) Runtime API.

This package is independent and is not an official Evokoa package. The wire contract is derived from Evokoa's public Runtime OpenAPI document and official Python SDK.

The design target is an upstreamable, production SDK rather than an application-specific wrapper. Public behavior is tracked against pinned machine-readable contracts; application transports remain injectable through Effect layers.

## Install

```sh
bun add polygres-sdk-effect effect@4.0.0-rc.112
```

## Usage

```ts
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { make } from "polygres-sdk-effect"

const program = Effect.gen(function* () {
  const polygres = yield* make({
    apiKey: Redacted.make(process.env.POLY_API_KEY!),
    projectId: "p0123456789abcdef0123456",
  })

  const readiness = yield* polygres.readiness()
  const evidence = yield* polygres.text.tsvector("intrusion campaign", {
    config: "evidence_body",
    limit: 10,
  })

  return { readiness, evidence }
})

await program.pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.runPromise,
)
```

`make` requires `HttpClient.HttpClient`, so production code can provide the fetch layer while tests and simulations provide an in-memory client. `layer(options)` provides the `PolygresClient` service for application-level dependency injection.

## Current Surface

- Retrieval readiness and passwordless connection metadata
- Graph expand, neighborhood, related, path, and connection
- Vector search and similar-row retrieval
- PostgreSQL full-text and fuzzy search
- Graph-first, vector-first, and joint hybrid retrieval
- Runtime response decoding with Effect Schema
- Typed configuration, transport, decode, authentication, permission, rate-limit, maintenance, not-found, and generic API errors
- Protected authentication/version headers and secret redaction
- Bounded transient retries and request timeouts
- Lazy cursor pagination as an Effect `Stream`
- Checked compatibility against pinned OpenAPI and official SDK method manifests

The first release intentionally excludes row writes and pgContext administration. Those mutation surfaces need idempotency and ambiguous-write semantics that should not be rushed into the read-path release.

See [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for runtime support and contract policy, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the path to full Runtime SDK parity.

## Development

```sh
bun install
bun run check
```

For a live readiness check, set `POLY_API_KEY` and either `POLY_PROJECT_ID` or `POLY_RUNTIME_URL`, then run:

```sh
bun run live:readiness
```

Never commit Project API keys or PostgreSQL passwords.
