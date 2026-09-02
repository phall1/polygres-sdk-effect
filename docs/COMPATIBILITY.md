# Compatibility

## Runtime Contract

The repository pins the Effect surface plus three upstream artifacts under `contracts/`:

- `runtime-v1.openapi.json`: upstream Runtime API snapshot.
- `python-sdk-v1.methods.json`: upstream official SDK behavior inventory.
- `python-sdk-v1.errors.py`: inert upstream canonical error catalog source; it is hashed and never executed.
- `effect-sdk-v1.surface.json`: operations implemented by this SDK.

`bun run contracts:check` validates operation identity, method/path bindings, lock structure, and local snapshot integrity without network access. This proves consistency among the checked-in files, not that the recorded commit exists remotely. `bun run contracts:refresh -- check` asks GitHub to resolve the official upstream repository and reports method and reachable request/response schema drift. See [`CONTRACT_REFRESH.md`](CONTRACT_REFRESH.md) for the update and agent handoff loop.

`effect-sdk-v1.surface.json` uses two distinct version fields. `default_api_version` is the exact Runtime behavior pin and must equal the locked manifest. `upstream_sdk_version` is the minimum upstream Python SDK version accepted for the declared Effect surface; it is strict SemVer, may be older than the current lock, and may never be newer. It is not automatically advanced by contract refreshes.

## Version Policy

This project is pre-1.0 while Effect 4 and the Polygres Runtime contract are both evolving. Until 1.0:

- Patch releases contain fixes and additive schema tolerance.
- Minor releases may add methods and models.
- Breaking public API changes require a minor release and migration notes.
- Runtime behavior is pinned with `X-Polygres-Api-Version`, independently of package version.

The compatibility baseline includes the original 14-method retrieval surface, `rows.validate`, `rows.insert`, `rows.upsert`, `rows.ignore`, and all 96 public pgContext methods from Python SDK 0.4.1. Those Context methods comprise 83 direct HTTP methods, 12 local query builders, and one composite operation waiter. Stable aliases remain independent public methods while sharing exact operation bindings.

Row writes have dedicated contracts for local validation, caller-owned idempotency, non-retry behavior, ambiguous initial outcomes, request-bound responses, and optional Context operation waiting. Contract-declared idempotent Context mutations reuse one eager key and byte-identical body across internal or external Effect retries. Ordinary Context writes dispatch once.

Retry behavior follows `python-sdk-v1.methods.json`, not HTTP verb inference or incidental transport flags in the Python implementation. The pinned manifest currently classifies `candidateSearch`, `rawVectorSearch`, `recommend`, `discover`, and `explore` as non-retryable even though Python passes `retryable=True`; this SDK keeps the safer manifest policy until the upstream contract resolves that discrepancy.

## Runtime Support

The distributed package uses web-standard APIs through Effect's `HttpClient` service and does not bundle a transport implementation. It supports:

- Bun 1.4 or newer
- Node.js 20 or newer
- Cloudflare Workers
- Other runtimes that can provide an Effect 4 `HttpClient.HttpClient`

Consumers provide `FetchHttpClient.layer` or a runtime-specific/test implementation.
