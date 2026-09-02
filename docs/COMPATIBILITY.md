# Compatibility

## Runtime Contract

The repository pins three machine-readable artifacts under `contracts/`:

- `runtime-v1.openapi.json`: upstream Runtime API snapshot.
- `python-sdk-v1.methods.json`: upstream official SDK behavior inventory.
- `effect-sdk-v1.surface.json`: operations implemented by this SDK.

`bun run contracts:check` fails when an implemented operation is absent from either upstream contract or when the API behavior version differs. Contract snapshot updates must be reviewed separately from generated client changes.

## Version Policy

This project is pre-1.0 while Effect 4 and the Polygres Runtime contract are both evolving. Until 1.0:

- Patch releases contain fixes and additive schema tolerance.
- Minor releases may add methods and models.
- Breaking public API changes require a minor release and migration notes.
- Runtime behavior is pinned with `X-Polygres-Api-Version`, independently of package version.

The initial compatibility baseline is the 14-method retrieval surface present since the official Python SDK 0.1 line. Modern pgContext and row-write support will only be marked stable after their retry, idempotency, and operation-waiting semantics have contract tests.

## Runtime Support

The distributed package uses web-standard APIs through Effect's `HttpClient` service and does not bundle a transport implementation. It supports:

- Bun 1.4 or newer
- Node.js 20 or newer
- Cloudflare Workers
- Other runtimes that can provide an Effect 4 `HttpClient.HttpClient`

Consumers provide `FetchHttpClient.layer` or a runtime-specific/test implementation.
