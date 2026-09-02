# Changelog

All notable changes will be documented here.

## Unreleased

### Added

- Domain module exports for `Polygres`, `Context`, `ContextQuery`, `Entity`, `Runtime`, `Graph`, `Vector`, `Text`, `Hybrid`, `Operation`, `Page`, `Rows`, and `PolygresError`.
- Schema-owned object inputs and normalized camelCase result models.
- Paired cold `.page()` and `.stream()` operations for every paginated retrieval method.
- Domain-qualified, lifecycle-specific errors with narrow construction and request unions.
- Immutable upstream contract provenance, semantic drift reports, scheduled checks, and agent-neutral update prompts.
- Compile-time API, error, stream, and Layer requirement proofs.
- Packed Bun/Node import and browser consumer-bundle verification.
- Contract-exact row validation, insert, upsert, and ignore methods with explicit ambiguous-write handling and optional Context reconciliation waiting.
- All 96 pinned pgContext methods, including administration, search, diagnostics, point mutation, cursor pagination, immutable query-plan builders, and durable operation waiting.
- Deterministic generators for the 102-method HTTP surface and 688-entry canonical error catalog.
- Type-aware OXC linting and formatting with explicit CI gates.

### Changed

- The minimum supported Node.js version is now 22.

### Fixed

- Graph path and connection requests no longer contain forbidden search fields.
- Nested `null` filter values are preserved.
- Hybrid results always contain normalized identity, properties, and score fields.
- Non-finite ranking values and non-JSON success responses fail as invalid responses.
- Non-JSON HTTP failures map by status, maintenance responses are not retried, and synchronized connection metadata fails closed.
- Empty pagination cursors terminate streams and echoed credentials are redacted from request IDs.
- Retry delays share a monotonic request budget, hostile `Retry-After` values cannot suspend requests indefinitely, and idempotent mutations require one protected printable-ASCII key.
- Row and Context operation responses fail closed when their identities do not match the request; embedded diagnostic metadata is sanitized without altering returned row data.
- Concurrent capability checks share one fiber-safe refresh, and schema-owned requests reject undeclared properties before dispatch.
