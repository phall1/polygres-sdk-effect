import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  analyzeContracts,
  assertSurfaceCompatibility,
  compareSemver,
  createLock,
  makeReport,
  parseArguments,
  renderPrompt,
  validateBundle,
  validateLock,
  validateSurface,
  withContractLock,
  writeBundle,
} from "../scripts/refresh-contract.js"

const encoder = new TextEncoder()
const commit = "a".repeat(40)
const surface = validateSurface({
  api_family: "v1",
  default_api_version: "2026-08-04",
  upstream_sdk_version: "0.4.0",
  methods: [
    {
      public_name: "vector.search",
      operation_id: "runtime_vector_search",
      method: "POST",
      path: "/v1/vector/search",
    },
  ],
})

const bundle = (
  options: {
    readonly changed?: boolean
    readonly added?: boolean
    readonly badHash?: boolean
    readonly requestSchema?: "string" | "array"
    readonly responseSchema?: "string" | "number"
    readonly sdkVersion?: string
    readonly retryPolicy?: string
    readonly pagination?: string
    readonly stability?: string
    readonly deprecated?: string
    readonly bindingKind?: string
    readonly swapBindings?: boolean
    readonly description?: string
    readonly renamed?: boolean
    readonly errorStatus?: number
  } = {},
) => {
  const paths: Record<string, Record<string, unknown>> = {
    "/v1/vector/search": {
      post: {
        operationId: "runtime_vector_search",
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/SearchRequest" } } },
        },
        responses: {
          200: { content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } } },
        },
      },
    },
    "/v1/retrieval/readiness": { get: { operationId: "runtime_retrieval_readiness" } },
  }
  if (options.added) paths["/v1/context/new-search"] = { post: { operationId: "runtime_context_new_search" } }
  const openapiBytes = encoder.encode(
    JSON.stringify({
      openapi: "3.1.0",
      paths,
      components: {
        schemas: {
          SearchRequest: {
            type: "object",
            properties: { query: { type: options.requestSchema ?? "string" } },
          },
          SearchResponse: {
            type: "object",
            properties: { id: { type: options.responseSchema ?? "string" } },
          },
        },
      },
    }),
  )
  const openapiHash = createHash("sha256").update(openapiBytes).digest("hex")
  const vectorOperation = {
    operation_id: "runtime_vector_search",
    method: "POST",
    path: "/v1/vector/search",
    ...(options.changed ? { retry_policy: "never" } : {}),
  }
  const readinessOperation = {
    operation_id: "runtime_retrieval_readiness",
    method: "GET",
    path: "/v1/retrieval/readiness",
  }
  const vectorOperations = options.swapBindings ? [readinessOperation] : [vectorOperation]
  const readinessOperations = options.swapBindings ? [vectorOperation] : [readinessOperation]
  const methods = [
    {
      public_name: options.renamed ? "project.vector.query" : "project.vector.search",
      binding_kind: options.bindingKind ?? "operation",
      deprecated: options.deprecated ?? null,
      description: options.description ?? "Search vectors.",
      operation_ids: vectorOperations.map((operation) => operation.operation_id),
      operations: vectorOperations,
      pagination: options.pagination ?? "none",
      retry_policy: options.retryPolicy ?? "none",
      stability: options.stability ?? "stable",
    },
    {
      public_name: "project.readiness",
      binding_kind: "operation",
      deprecated: null,
      description: "Check readiness.",
      operation_ids: readinessOperations.map((operation) => operation.operation_id),
      operations: readinessOperations,
      pagination: "none",
      retry_policy: "read_only_get",
      stability: "stable",
    },
    ...(options.added
      ? [
          {
            public_name: "project.context.new_search",
            operations: [
              {
                operation_id: "runtime_context_new_search",
                method: "POST",
                path: "/v1/context/new-search",
              },
            ],
          },
        ]
      : []),
  ]
  const manifestBytes = encoder.encode(
    JSON.stringify({
      schema_version: 1,
      sdk: "polygres-sdk",
      sdk_version: options.sdkVersion ?? (options.added ? "0.5.0" : "0.4.1"),
      api_family: "v1",
      default_api_version: "2026-08-04",
      openapi_sha256: options.badHash ? "0".repeat(64) : openapiHash,
      methods,
    }),
  )
  const errorCatalogBytes = encoder.encode(`ERROR_CATALOG_DATA = tuple([{
    'code': 'TEST_ERROR',
    'http_status': ${options.errorStatus ?? 500},
    'message': 'First ' 'message.',
    'safe_detail_fields': ['field'],
    'variants': {'specific': {'message': 'Variant.', 'http_status': 409}}
  }])\n`)
  return validateBundle({
    commit,
    trackingRef: "refs/heads/main",
    bytes: {
      "runtime-v1.openapi.json": openapiBytes,
      "python-sdk-v1.methods.json": manifestBytes,
      "python-sdk-v1.errors.py": errorCatalogBytes,
    },
    surface,
  })
}

test("contract analysis separates new capabilities from implemented changes", () => {
  const changes = analyzeContracts(bundle(), bundle({ added: true }), surface)

  expect(changes.methodsAdded).toEqual(["project.context.new_search"])
  expect(changes.operationsAdded).toEqual(["runtime_context_new_search"])
  expect(changes.implementedAffected).toEqual([])
})

test("contract analysis identifies changed implemented manifest operations", () => {
  const changes = analyzeContracts(bundle(), bundle({ changed: true }), surface)

  expect(changes.operationsChanged).toEqual(["runtime_vector_search"])
  expect(changes.implementedAffected).toEqual(["vector.search"])
})

test.each([
  ["retry_policy", { retryPolicy: "idempotent_mutation" }],
  ["pagination", { pagination: "cursor" }],
  ["stability", { stability: "experimental" }],
  ["deprecated", { deprecated: "Use project.search instead." }],
  ["binding_kind", { bindingKind: "composed" }],
] as const)("method-level %s drift requires implemented work", (_field, options) => {
  const previous = bundle()
  const next = bundle(options)
  const changes = analyzeContracts(previous, next, surface)
  const report = makeReport("drift", previous, next, surface)

  expect(changes.methodPoliciesChanged).toEqual(["project.vector.search"])
  expect(changes.operationsChanged).toEqual([])
  expect(changes.implementedAffected).toEqual(["vector.search"])
  expect(report.requiresImplementation).toBe(true)
})

test("method operation binding drift requires implemented work", () => {
  const changes = analyzeContracts(bundle(), bundle({ swapBindings: true }), surface)

  expect(changes.methodPoliciesChanged).toEqual(["project.readiness", "project.vector.search"])
  expect(changes.operationsChanged).toEqual([])
  expect(changes.operationsAdded).toEqual([])
  expect(changes.operationsRemoved).toEqual([])
  expect(changes.implementedAffected).toEqual(["vector.search"])
})

test("method renames retaining an operation still require implemented review", () => {
  const changes = analyzeContracts(bundle(), bundle({ renamed: true }), surface)

  expect(changes.methodsAdded).toEqual(["project.vector.query"])
  expect(changes.methodsRemoved).toEqual(["project.vector.search"])
  expect(changes.implementedAffected).toEqual(["vector.search"])
})

test("error catalog drift affects every implemented operation", () => {
  const changes = analyzeContracts(bundle(), bundle({ errorStatus: 503 }), surface)

  expect(changes.errorCatalogChanged).toBe(true)
  expect(changes.implementedAffected).toEqual(["vector.search"])
})

test("method documentation-only drift does not require implementation", () => {
  const previous = bundle()
  const next = bundle({ description: "Search vectors with the configured index." })
  const changes = analyzeContracts(previous, next, surface)
  const report = makeReport("drift", previous, next, surface)

  expect(changes.methodPoliciesChanged).toEqual([])
  expect(changes.operationsChanged).toEqual([])
  expect(changes.implementedAffected).toEqual([])
  expect(report.snapshotsChanged).toBe(true)
  expect(report.requiresImplementation).toBe(false)
})

test("contract analysis follows request schema component references", () => {
  const changes = analyzeContracts(bundle(), bundle({ requestSchema: "array" }), surface)

  expect(changes.operationsChanged).toEqual(["runtime_vector_search"])
  expect(changes.implementedAffected).toEqual(["vector.search"])
})

test("contract analysis follows response schema component references", () => {
  const changes = analyzeContracts(bundle(), bundle({ responseSchema: "number" }), surface)

  expect(changes.operationsChanged).toEqual(["runtime_vector_search"])
  expect(changes.implementedAffected).toEqual(["vector.search"])
})

test("contract validation rejects mismatched OpenAPI integrity", () => {
  expect(() => bundle({ badHash: true })).toThrow("OpenAPI hash mismatch")
})

test("strict SemVer comparison handles prereleases and rejects invalid versions", () => {
  expect(compareSemver("1.0.0-alpha.10", "1.0.0-alpha.2")).toBeGreaterThan(0)
  expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0)
  expect(compareSemver("1.0.0+build.2", "1.0.0+build.1")).toBe(0)
  expect(() => compareSemver("01.0.0", "1.0.0")).toThrow("Invalid SDK version")
  expect(() => compareSemver("1.0.0-alpha.01", "1.0.0-alpha.1")).toThrow("Invalid SDK version")
})

test("CLI parser requires known, unique flags and explicit values", () => {
  expect(parseArguments(["--", "check", "--ref", "polygres-sdk-v0.5.0", "--format", "json"])).toEqual({
    command: "check",
    ref: "polygres-sdk-v0.5.0",
    format: "json",
    allowDowngrade: false,
  })
  expect(() => parseArguments(["check", "--ref"])).toThrow("Missing value for --ref")
  expect(() => parseArguments(["check", "--format", "--allow-downgrade"])).toThrow("Missing value for --format")
  expect(() => parseArguments(["check", "--format", "json", "--format", "human"])).toThrow(
    "Duplicate argument: --format",
  )
  expect(() => parseArguments(["check", "--unknown"])).toThrow("Unknown argument: --unknown")
  expect(() => parseArguments(["check", "extra"])).toThrow("Unknown argument: extra")
})

test("offline lock validation requires exact allowlisted structure", () => {
  const lock = createLock(bundle())
  expect(validateLock(lock)).toEqual(lock)
  expect(() => validateLock({ ...lock, repository: "https://github.com/example/fork" })).toThrow(
    "Unsupported upstream repository",
  )
  expect(() =>
    validateLock({
      ...lock,
      artifacts: {
        ...lock.artifacts,
        "runtime-v1.openapi.json": { ...lock.artifacts["runtime-v1.openapi.json"], sha256: "abc" },
      },
    }),
  ).toThrow("Invalid SHA-256")
  expect(() => validateLock({ ...lock, unexpected: true })).toThrow("Invalid contract lock structure")
  expect(() => validateLock({ ...lock, tracking_ref: "b".repeat(40) })).toThrow(
    "tracking_ref does not match resolved_commit",
  )
})

test("surface SDK version is an enforced minimum accepted baseline", () => {
  const current = bundle()
  expect(() => assertSurfaceCompatibility(surface, current)).not.toThrow()
  const futureSurface = validateSurface({ ...surface, upstream_sdk_version: "0.5.0" })
  expect(() => assertSurfaceCompatibility(futureSurface, current)).toThrow("is newer than locked SDK")
  expect(() => validateSurface({ ...surface, upstream_sdk_version: "0.04.0" })).toThrow("Invalid SDK version")
})

test("contract lock excludes concurrent readers and writers", async () => {
  const root = await mkdtemp(join(tmpdir(), "polygres-contract-lock-"))
  await mkdir(join(root, "contracts"))
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const acquired = new Promise<void>((resolve) => {
    entered = resolve
  })
  const holder = withContractLock(root, async () => {
    entered()
    await blocked
  })
  await acquired
  await expect(withContractLock(root, async () => undefined)).rejects.toThrow("locked by another process")
  release()
  await holder
  await expect(withContractLock(root, async () => "available")).resolves.toBe("available")
  await rm(root, { recursive: true, force: true })
})

test("contract update rejects a lock changed before write ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "polygres-contract-stale-"))
  const contracts = join(root, "contracts")
  await mkdir(contracts)
  const current = bundle()
  const expectedLock = createLock(current)
  const changedLock = { ...expectedLock, tracking_ref: "refs/tags/concurrent-update" }
  await Promise.all([
    writeFile(join(contracts, "runtime-v1.openapi.json"), current.bytes["runtime-v1.openapi.json"]),
    writeFile(join(contracts, "python-sdk-v1.methods.json"), current.bytes["python-sdk-v1.methods.json"]),
    writeFile(join(contracts, "python-sdk-v1.errors.py"), current.bytes["python-sdk-v1.errors.py"]),
    writeFile(join(contracts, "upstream-v1.lock.json"), `${JSON.stringify(changedLock, null, 2)}\n`),
  ])

  await expect(writeBundle(root, current, surface, expectedLock)).rejects.toThrow(
    "Contract lock changed while refresh was running",
  )
  expect(JSON.parse(await Bun.file(join(contracts, "upstream-v1.lock.json")).text())).toEqual(changedLock)
  await rm(root, { recursive: true, force: true })
})

test("prompt is directly usable by any coding agent", () => {
  const prompt = renderPrompt({
    status: "drift",
    source: {
      repository: "https://github.com/Evokoa/polygres-sdk",
      previousCommit: "a".repeat(40),
      resolvedCommit: "b".repeat(40),
      trackingRef: "refs/heads/main",
    },
    versions: { previousSdk: "0.4.1", nextSdk: "0.5.0", previousApi: "2026-08-04", nextApi: "2026-09-01" },
    changes: {
      methodsAdded: ["project.context.new_search"],
      methodsRemoved: [],
      methodPoliciesChanged: [],
      errorCatalogChanged: false,
      operationsAdded: ["runtime_context_new_search"],
      operationsRemoved: [],
      operationsChanged: ["runtime_vector_search"],
      operationsRelocated: [],
      implementedAffected: ["vector.search"],
    },
    requiresImplementation: true,
    snapshotsChanged: true,
  })

  expect(prompt).toContain("Reconcile and test implemented operation `vector.search`")
  expect(prompt).toContain("Evaluate upstream method `project.context.new_search`")
  expect(prompt).toContain("Do not edit downloaded snapshots manually")
})
