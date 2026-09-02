# Roadmap

The goal is complete, contract-verified coverage of the application-facing Polygres Runtime API without reproducing the Python SDK's synchronous architecture.

## 0.1: Retrieval Foundation

- Stable 14-method graph, vector, text, and hybrid retrieval baseline.
- Effect service/layer composition and injectable HTTP transport.
- Effect Schema response validation and tagged failures.
- Cursor pagination as an Effect Stream.
- Bun, Node.js, and Cloudflare-compatible distribution.

## 0.2: Safe Mutations And Context Core

- Row validation, insert, upsert, and ignore.
- Explicit ambiguous-write errors and zero automatic row-write retries.
- Idempotency-key codecs and Context reconciliation.
- Context capabilities, collection lifecycle, search/query/count/facets, and durable operation polling.
- Stage-aware operation waiter with deadline and cancellation semantics.

## 0.3: Full Runtime SDK Parity

- Remaining application-facing Context administration and retrieval methods.
- Local typed query-plan builders.
- Generated canonical error catalog with safe-detail filtering.
- Machine-checked parity for all official Python SDK methods and exclusions.
- Cross-SDK shared contract fixtures.

## 1.0: Stable Upstream Candidate

- No unexplained Runtime OpenAPI coverage gaps.
- Compatibility suite run against a live standard project and a synchronized project.
- Documented support window for Effect and Runtime API versions.
- Signed npm releases with provenance and automated changelogs.
