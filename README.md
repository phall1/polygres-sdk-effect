# Polygres SDK for Effect

[![CI](https://github.com/phall1/polygres-sdk-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/phall1/polygres-sdk-effect/actions/workflows/ci.yml)

Graph, vector, text, hybrid search, safe row writes, and full pgContext, built directly on Effect.

**Contract-pinned. Retry-safe. Worker-ready.**

## Why This SDK

- All 96 pgContext methods, not a partial wrapper
- Schema-validated inputs and camelCase results
- Typed failures instead of mystery exceptions
- Cold Effect streams for cursor pagination
- Safe idempotency, deadlines, and operation polling
- Bun, Node.js 22+, and web-standard runtime support

## Try It

```ts
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Polygres } from "polygres-sdk-effect"

const results = await Effect.gen(function* () {
  const db = yield* Polygres.make({
    apiKey: Redacted.make(process.env.POLY_API_KEY!),
    projectId: process.env.POLY_PROJECT_ID!,
  })

  return yield* db.context.search({
    collection: "documents",
    embedding: [0.12, -0.08, 0.34],
    limit: 10,
  })
}).pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise)

console.log(results.results)
```

Prefer dependency injection? `Polygres.layer(options)` provides the yieldable `Polygres.Client` service.

## API At A Glance

| Need                                 | API                                             |
| ------------------------------------ | ----------------------------------------------- |
| Graph traversal                      | `db.graph.*`                                    |
| Vector search                        | `db.vector.*`                                   |
| Full-text search                     | `db.text.*`                                     |
| Hybrid ranking                       | `db.hybrid.*`                                   |
| Insert, upsert, ignore               | `db.rows.*`                                     |
| Collections, points, indexes, search | `db.context.*`                                  |
| Async operation lifecycle            | `db.context.waitForOperation(...)`              |
| Cursor pagination                    | `operation.page(...)` / `operation.stream(...)` |

Every method takes one object input. Nullable response fields use `Option`. Runtime wire casing stays private.

## Writes That Fail Safely

```ts
yield* db.rows.upsert({
  schema: "public",
  table: "documents",
  row: { id: "doc-42", body: "Evidence, not vibes." },
  conflictColumns: ["id"],
})
```

- Row writes are never automatically retried.
- Uncertain outcomes fail as `PolygresError.AmbiguousWrite`.
- Idempotent Context mutations reuse one exact key and body.
- `timeout` bounds each attempt; `deadline` bounds the whole operation.
- Operation polling is interruptible and never cancels server work implicitly.

## Install

```sh
bun add polygres-sdk-effect effect@4.0.0-rc.112
```

## Contract Proof

The public surface is mechanically checked against an immutable upstream SDK and OpenAPI snapshot.

```sh
bun run contracts:check
bun run contracts:refresh -- check
```

- 102 network-facing methods verified
- 688 canonical errors generated and checked
- Packed declarations tested in Bun, Node.js, and a browser bundle
- Security, retry, pagination, schema, and binding drift detected in CI

See [compatibility](docs/COMPATIBILITY.md), [contract refresh](docs/CONTRACT_REFRESH.md), and the [roadmap](docs/ROADMAP.md).

## Live Checks

Set `POLY_API_KEY` and either `POLY_PROJECT_ID` or `POLY_RUNTIME_URL`.

```sh
bun run live:readiness
bun run live:context
```

These probes are non-mutating and do not print credentials. Never commit Project API keys or PostgreSQL passwords.

---

Independent Apache-2.0 project built for the [Polygres](https://polygres.com) Runtime API.
