# Contributing

## Setup

```sh
bun install
bun run check
```

Use Bun 1.4+ for dependency management, scripts, tests, and local release verification. The package targets TypeScript 7 and the latest tested Effect 4 release candidate.

## Contract Changes

Every public Runtime method must have:

- An entry in `contracts/effect-sdk-v1.surface.json`.
- A matching operation in both pinned upstream contract snapshots.
- Request serialization tests.
- Strict success-response decoding tests with additive fields represented where the Runtime permits them.
- Error, timeout, and declared retry-policy tests.
- Documentation of mutation idempotency and ambiguous outcomes, when applicable.

Do not infer behavior from endpoint names. The official Python method manifest is the behavioral baseline, and the OpenAPI document is the wire-shape baseline.

## Security

Never commit or print live API keys, database passwords, authorization headers, or raw request objects containing credentials. Test keys must match the documented shape but remain inert fixtures.
