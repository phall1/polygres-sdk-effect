# Contract Refresh

The SDK tracks canonical artifacts published by [`Evokoa/polygres-sdk`](https://github.com/Evokoa/polygres-sdk). Refreshing contracts never clones or executes upstream code.

## Check

```sh
bun run contracts:refresh -- check
```

The command asks GitHub to resolve `main` to a commit ID, downloads all three upstream artifacts using that ID, validates their shared provenance, OpenAPI hash, and operation bindings, then compares them with the locked snapshots. The Python error catalog remains inert source text and is never imported or executed. Request, response, path-parameter, transitively referenced component schemas, method policies, and canonical error catalog changes are included when deciding whether an implemented operation changed. It exits with:

- `0` when the snapshots are current.
- `1` when contract drift exists or an implemented operation needs work.
- `2` for network, integrity metadata, validation, downgrade, or unsafe-write failures.

Use `--ref polygres-sdk-v0.4.1` to inspect a release tag. Output formats are `human`, `json`, and `prompt`.

## Update

```sh
bun run contracts:refresh -- update --format prompt
```

This writes exact downloaded bytes and `contracts/upstream-v1.lock.json`, runs the offline verifier, and prints a task suitable for any coding agent. The updater never edits `effect-sdk-v1.surface.json` or SDK code.

After reviewing an error-catalog change, run `bun run catalog:generate` explicitly. The generator parses only the pinned Python literal data, never imports or executes Python, and formats the private TypeScript lookup with the pinned toolchain. The offline verifier deep-compares every generated descriptor, including retry class, with that inert source.

After changing the implemented HTTP surface, run `bun run contracts:surface`. This generates the declaration from the reviewed retrieval, row, and Context binding registries. Stable aliases may share an operation ID only when their method and path are identical. `contracts:check` rejects a stale generated surface, a conflicting shared binding, or any mismatch with the pinned OpenAPI.

Updates use an exclusive `contracts/.contract-refresh.lock` directory. A second checker or updater fails rather than reading or overwriting a transaction in progress, and an updater rechecks the expected local snapshot after taking the lock. Each replacement is atomic, but the four-file transaction is not claimed to be atomic across a process or machine crash. A handled write failure restores files while the updater still owns the lock; if that restoration is incomplete, the error identifies a preserved `.contract-refresh-stage-*` recovery directory. An abandoned lock after an unclean process termination must be inspected before it is removed manually.

An agent-neutral loop is:

```text
Run `bun run contracts:refresh -- update --format prompt`.
If it exits 1, treat its stdout as the implementation task.
Reconcile each affected operation without weakening transport, storage, validation, or error boundaries.
Add focused behavioral and compile-time tests.
Run `bun run check` and then `bun run contracts:refresh -- check`.
Stop only when both commands pass, or report the concrete upstream blocker.
```

JSON output is the stable integration surface for bots and orchestration systems:

```sh
bun run contracts:refresh -- check --format json
```

It distinguishes newly added upstream candidates from changes to operations already implemented by this SDK, so an agent does not receive the full existing parity backlog on every refresh.

## Safety

- During an online refresh, all three upstream artifacts are requested from one 40-character commit ID in the allowlisted official repository.
- Source paths and repository identity are allowlisted.
- The Python manifest must bind the downloaded OpenAPI SHA-256.
- Operation IDs, methods, paths, and reachable request/response schemas are cross-checked before writes.
- Offline checks validate the lock's exact structure, allowlisted metadata, and local artifact hashes. They do not prove that a lock and snapshots edited together came from the recorded remote commit.
- Strict SemVer precedence, including prereleases, rejects SDK downgrades unless `--allow-downgrade` is explicit. A downgrade below the Effect surface baseline is always rejected.
- CLI options reject unknown or duplicate flags and missing values.
- Concurrent local checks and updates are excluded by the same filesystem lock.
- Ordinary CI remains offline; the scheduled workflow performs the network drift check.
