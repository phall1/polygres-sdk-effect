import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { type ErrorCatalog, parsePythonErrorCatalog } from "./parse-error-catalog.js"

const repository = "Evokoa/polygres-sdk"
const repositoryUrl = `https://github.com/${repository}`
const artifactSources = {
  "runtime-v1.openapi.json": "src/polygres/spec/runtime-v1.openapi.json",
  "python-sdk-v1.methods.json": "src/polygres/spec/python-sdk-v1.methods.json",
  "python-sdk-v1.errors.py": "src/polygres/_vendor/polygres_lib/errors/generated.py",
} as const
const httpMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])
const sha256Pattern = /^[0-9a-f]{64}$/
const commitPattern = /^[0-9a-f]{40}$/

type ArtifactName = keyof typeof artifactSources
type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }
type JsonObject = { readonly [key: string]: Json }
type Operation = {
  readonly operation_id: string
  readonly method: string
  readonly path: string
  readonly [key: string]: Json
}
type SdkMethod = {
  readonly public_name: string
  readonly operations: ReadonlyArray<Operation>
  readonly [key: string]: Json
}
type MethodManifest = {
  readonly schema_version: number
  readonly sdk: string
  readonly sdk_version: string
  readonly api_family: string
  readonly default_api_version: string
  readonly openapi_sha256: string
  readonly methods: ReadonlyArray<SdkMethod>
}
type OpenApi = {
  readonly paths: Readonly<Record<string, JsonObject>>
  readonly [key: string]: Json
}
type SurfaceMethod = {
  readonly public_name: string
  readonly operation_id: string
  readonly method: string
  readonly path: string
}
export type Surface = {
  readonly api_family: "v1"
  readonly default_api_version: string
  readonly upstream_sdk_version: string
  readonly methods: ReadonlyArray<SurfaceMethod>
}
export type Lock = {
  readonly schema_version: 1
  readonly repository: string
  readonly tracking_ref: string
  readonly resolved_commit: string
  readonly sdk_version: string
  readonly artifacts: Readonly<Record<ArtifactName, { readonly source: string; readonly sha256: string }>>
}

export interface ContractBundle {
  readonly commit: string
  readonly trackingRef: string
  readonly bytes: Readonly<Record<ArtifactName, Uint8Array>>
  readonly openapi: OpenApi
  readonly manifest: MethodManifest
  readonly errorCatalog: ErrorCatalog
}

export interface ContractChanges {
  readonly methodsAdded: ReadonlyArray<string>
  readonly methodsRemoved: ReadonlyArray<string>
  readonly methodPoliciesChanged: ReadonlyArray<string>
  readonly errorCatalogChanged: boolean
  readonly operationsAdded: ReadonlyArray<string>
  readonly operationsRemoved: ReadonlyArray<string>
  readonly operationsChanged: ReadonlyArray<string>
  readonly operationsRelocated: ReadonlyArray<string>
  readonly implementedAffected: ReadonlyArray<string>
}

export interface ContractReport {
  readonly status: "current" | "drift" | "updated"
  readonly source: {
    readonly repository: string
    readonly previousCommit: string
    readonly resolvedCommit: string
    readonly trackingRef: string
  }
  readonly versions: {
    readonly previousSdk: string
    readonly nextSdk: string
    readonly previousApi: string
    readonly nextApi: string
  }
  readonly changes: ContractChanges
  readonly requiresImplementation: boolean
  readonly snapshotsChanged: boolean
}

type Semver = {
  readonly major: bigint
  readonly minor: bigint
  readonly patch: bigint
  readonly prerelease: ReadonlyArray<string>
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const parseJson = (bytes: Uint8Array, name: string): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new Error(`${name} is not valid JSON`, { cause })
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stable = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  const object = value as { readonly [key: string]: Json }
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key] ?? null)}`)
    .join(",")}}`
}

const parseSemver = (value: string): Semver => {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    )
  if (match === null) throw new Error(`Invalid SDK version: ${value}`)
  const major = match[1]
  const minor = match[2]
  const patch = match[3]
  if (major === undefined || minor === undefined || patch === undefined)
    throw new Error(`Invalid SDK version: ${value}`)
  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    prerelease: match[4]?.split(".") ?? [],
  }
}

export const compareSemver = (left: string, right: string): number => {
  const leftVersion = parseSemver(left)
  const rightVersion = parseSemver(right)
  for (const key of ["major", "minor", "patch"] as const) {
    if (leftVersion[key] < rightVersion[key]) return -1
    if (leftVersion[key] > rightVersion[key]) return 1
  }
  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    return leftVersion.prerelease.length === rightVersion.prerelease.length
      ? 0
      : leftVersion.prerelease.length === 0
        ? 1
        : -1
  }
  const count = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

const validateTrackingRef = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid tracking_ref")
  if (commitPattern.test(value)) return value
  if (!/^refs\/(?:heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) {
    throw new Error(`Invalid tracking_ref: ${value}`)
  }
  if (value.includes("..") || value.includes("//") || value.endsWith("/") || value.endsWith(".")) {
    throw new Error(`Invalid tracking_ref: ${value}`)
  }
  return value
}

export const validateSurface = (value: unknown): Surface => {
  if (!isObject(value) || value.api_family !== "v1") throw new Error("Unsupported Effect surface identity")
  if (typeof value.default_api_version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.default_api_version)) {
    throw new Error("Invalid Effect surface API version")
  }
  if (typeof value.upstream_sdk_version !== "string") throw new Error("Invalid Effect surface SDK baseline")
  parseSemver(value.upstream_sdk_version)
  if (!Array.isArray(value.methods)) throw new Error("Invalid Effect surface methods")
  const publicNames = new Set<string>()
  const operationIds = new Set<string>()
  const methods = value.methods.map((candidate) => {
    if (!isObject(candidate)) throw new Error("Invalid Effect surface method")
    const { public_name, operation_id, method, path } = candidate
    if (
      typeof public_name !== "string" ||
      public_name.length === 0 ||
      typeof operation_id !== "string" ||
      operation_id.length === 0 ||
      typeof method !== "string" ||
      !httpMethods.has(method.toLowerCase()) ||
      method !== method.toUpperCase() ||
      typeof path !== "string" ||
      !path.startsWith("/")
    ) {
      throw new Error("Invalid Effect surface method")
    }
    if (publicNames.has(public_name)) throw new Error(`Duplicate Effect method: ${public_name}`)
    if (operationIds.has(operation_id)) throw new Error(`Duplicate Effect operation: ${operation_id}`)
    publicNames.add(public_name)
    operationIds.add(operation_id)
    return { public_name, operation_id, method, path }
  })
  return {
    api_family: "v1",
    default_api_version: value.default_api_version,
    upstream_sdk_version: value.upstream_sdk_version,
    methods,
  }
}

export const validateLock = (value: unknown): Lock => {
  if (!isObject(value) || value.schema_version !== 1) throw new Error("Unsupported contract lock schema")
  const expectedKeys = ["artifacts", "repository", "resolved_commit", "schema_version", "sdk_version", "tracking_ref"]
  if (Object.keys(value).sort().join(",") !== expectedKeys.join(",")) throw new Error("Invalid contract lock structure")
  if (value.repository !== repositoryUrl)
    throw new Error(`Unsupported upstream repository: ${String(value.repository)}`)
  if (typeof value.resolved_commit !== "string" || !commitPattern.test(value.resolved_commit)) {
    throw new Error(`Invalid resolved commit: ${String(value.resolved_commit)}`)
  }
  const trackingRef = validateTrackingRef(value.tracking_ref)
  if (commitPattern.test(trackingRef) && trackingRef !== value.resolved_commit) {
    throw new Error("Locked commit tracking_ref does not match resolved_commit")
  }
  if (typeof value.sdk_version !== "string") throw new Error("Invalid locked SDK version")
  parseSemver(value.sdk_version)
  if (!isObject(value.artifacts)) throw new Error("Invalid locked artifacts")
  const artifactNames = Object.keys(value.artifacts).sort()
  if (artifactNames.join(",") !== Object.keys(artifactSources).sort().join(",")) {
    throw new Error("Invalid locked artifact set")
  }
  const artifacts = {} as Record<ArtifactName, { source: string; sha256: string }>
  for (const [name, source] of Object.entries(artifactSources) as ReadonlyArray<[ArtifactName, string]>) {
    const artifact = value.artifacts[name]
    if (!isObject(artifact) || Object.keys(artifact).sort().join(",") !== "sha256,source") {
      throw new Error(`Invalid lock entry for ${name}`)
    }
    if (artifact.source !== source) throw new Error(`Unsafe source path for ${name}`)
    if (typeof artifact.sha256 !== "string" || !sha256Pattern.test(artifact.sha256)) {
      throw new Error(`Invalid SHA-256 for ${name}`)
    }
    artifacts[name] = { source, sha256: artifact.sha256 }
  }
  return {
    schema_version: 1,
    repository: repositoryUrl,
    tracking_ref: trackingRef,
    resolved_commit: value.resolved_commit,
    sdk_version: value.sdk_version,
    artifacts,
  }
}

const jsonPointer = (root: OpenApi, reference: string): Json => {
  if (!reference.startsWith("#/")) throw new Error(`Unsupported non-local OpenAPI reference: ${reference}`)
  let value: Json = root
  for (const encoded of reference.slice(2).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~")
    if (value === null || typeof value !== "object" || Array.isArray(value) || !(key in value)) {
      throw new Error(`Unresolved OpenAPI reference: ${reference}`)
    }
    value = (value as JsonObject)[key] ?? null
  }
  return value
}

const operationContract = (openapi: OpenApi, pathItem: JsonObject, operation: JsonObject): Json => {
  const contract: Json = {
    parameters: [pathItem.parameters ?? null, operation.parameters ?? null],
    requestBody: operation.requestBody ?? null,
    responses: operation.responses ?? null,
  }
  const references: Record<string, Json> = {}
  const visit = (value: Json): void => {
    if (value === null || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const [key, candidate] of Object.entries(value)) {
      if ((key === "$ref" || key === "$dynamicRef") && typeof candidate === "string") {
        if (references[candidate] === undefined) {
          const target = jsonPointer(openapi, candidate)
          references[candidate] = target
          visit(target)
        }
      } else {
        visit(candidate)
      }
    }
  }
  visit(contract)
  return { contract, references }
}

type IndexedOperation = { readonly method: string; readonly path: string; readonly contract: Json }

const operationIndex = (openapi: OpenApi): Map<string, IndexedOperation> => {
  const index = new Map<string, IndexedOperation>()
  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    if (!isObject(pathItem)) throw new Error(`Invalid OpenAPI path item: ${path}`)
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue
      if (!isObject(candidate)) throw new Error(`Invalid OpenAPI operation: ${method.toUpperCase()} ${path}`)
      const operationId = candidate.operationId
      if (typeof operationId !== "string" || operationId.length === 0) continue
      if (index.has(operationId)) throw new Error(`Duplicate OpenAPI operationId: ${operationId}`)
      index.set(operationId, {
        method: method.toUpperCase(),
        path,
        contract: operationContract(openapi, pathItem as JsonObject, candidate as JsonObject),
      })
    }
  }
  return index
}

export const validateBundle = (input: {
  readonly commit: string
  readonly trackingRef: string
  readonly bytes: Readonly<Record<ArtifactName, Uint8Array>>
  readonly surface: Surface
}): ContractBundle => {
  if (!commitPattern.test(input.commit)) throw new Error(`Invalid resolved commit: ${input.commit}`)
  validateTrackingRef(input.trackingRef)
  validateSurface(input.surface)
  const openapiValue = parseJson(input.bytes["runtime-v1.openapi.json"], "runtime-v1.openapi.json")
  if (!isObject(openapiValue) || !isObject(openapiValue.paths)) throw new Error("Invalid Runtime OpenAPI structure")
  const openapi = openapiValue as OpenApi
  const manifestValue = parseJson(input.bytes["python-sdk-v1.methods.json"], "python-sdk-v1.methods.json")
  if (!isObject(manifestValue)) throw new Error("Invalid Python SDK manifest structure")
  if (manifestValue.schema_version !== 1 || manifestValue.sdk !== "polygres-sdk" || manifestValue.api_family !== "v1") {
    throw new Error("Unsupported Python SDK contract identity")
  }
  if (typeof manifestValue.sdk_version !== "string") throw new Error("Invalid Python SDK version")
  parseSemver(manifestValue.sdk_version)
  if (
    typeof manifestValue.default_api_version !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifestValue.default_api_version)
  ) {
    throw new Error(`Invalid Runtime API version: ${String(manifestValue.default_api_version)}`)
  }
  if (typeof manifestValue.openapi_sha256 !== "string" || !sha256Pattern.test(manifestValue.openapi_sha256)) {
    throw new Error("Invalid OpenAPI hash in Python SDK manifest")
  }
  if (!Array.isArray(manifestValue.methods)) throw new Error("Invalid Python SDK methods")
  const manifest = manifestValue as MethodManifest
  const openapiHash = sha256(input.bytes["runtime-v1.openapi.json"])
  if (manifest.openapi_sha256 !== openapiHash) {
    throw new Error(`OpenAPI hash mismatch: manifest=${manifest.openapi_sha256} downloaded=${openapiHash}`)
  }

  const openapiOperations = operationIndex(openapi)
  const manifestOperations = new Map<string, Operation>()
  const publicNames = new Set<string>()
  for (const method of manifest.methods) {
    if (!isObject(method) || typeof method.public_name !== "string" || !Array.isArray(method.operations)) {
      throw new Error("Invalid Python SDK method")
    }
    if (publicNames.has(method.public_name)) throw new Error(`Duplicate Python method: ${method.public_name}`)
    publicNames.add(method.public_name)
    for (const operation of method.operations) {
      if (
        !isObject(operation) ||
        typeof operation.operation_id !== "string" ||
        typeof operation.method !== "string" ||
        typeof operation.path !== "string"
      ) {
        throw new Error(`Invalid Python operation for ${method.public_name}`)
      }
      const validOperation = operation as Operation
      const existing = manifestOperations.get(validOperation.operation_id)
      if (existing !== undefined && stable(existing) !== stable(validOperation)) {
        throw new Error(`Conflicting Python operation binding: ${operation.operation_id}`)
      }
      const upstream = openapiOperations.get(operation.operation_id)
      if (upstream === undefined || upstream.method !== operation.method || upstream.path !== operation.path) {
        throw new Error(`Python operation does not match OpenAPI: ${operation.operation_id}`)
      }
      if (existing === undefined) manifestOperations.set(operation.operation_id, validOperation)
    }
  }

  const errorCatalog = parsePythonErrorCatalog(new TextDecoder().decode(input.bytes["python-sdk-v1.errors.py"]))
  return { ...input, openapi, manifest, errorCatalog }
}

const manifestOperationIndex = (manifest: MethodManifest): Map<string, Operation> =>
  new Map(
    manifest.methods.flatMap((method) => method.operations.map((operation) => [operation.operation_id, operation])),
  )

// Keep presentation metadata out of implementation-impact decisions.
const methodPolicy = (method: SdkMethod): Json => ({
  binding_kind: method.binding_kind ?? null,
  deprecated: method.deprecated ?? null,
  operation_bindings: method.operations.map((operation) => operation.operation_id),
  pagination: method.pagination ?? null,
  retry_policy: method.retry_policy ?? null,
  stability: method.stability ?? null,
})

const sortedDifference = (left: Iterable<string>, right: ReadonlySet<string>): ReadonlyArray<string> =>
  [...left].filter((value) => !right.has(value)).sort()

export const analyzeContracts = (previous: ContractBundle, next: ContractBundle, surface: Surface): ContractChanges => {
  const previousMethods = new Map(previous.manifest.methods.map((method) => [method.public_name, method]))
  const nextMethods = new Map(next.manifest.methods.map((method) => [method.public_name, method]))
  const previousOperations = manifestOperationIndex(previous.manifest)
  const nextOperations = manifestOperationIndex(next.manifest)
  const previousOpenapiOperations = operationIndex(previous.openapi)
  const nextOpenapiOperations = operationIndex(next.openapi)
  const methodPoliciesChanged: string[] = []
  const policyAffectedOperations = new Set<string>()
  for (const [name, method] of previousMethods) {
    const candidate = nextMethods.get(name)
    if (candidate === undefined) {
      for (const operation of method.operations) policyAffectedOperations.add(operation.operation_id)
      continue
    }
    if (stable(methodPolicy(method)) === stable(methodPolicy(candidate))) continue
    methodPoliciesChanged.push(name)
    for (const operation of [...method.operations, ...candidate.operations]) {
      policyAffectedOperations.add(operation.operation_id)
    }
  }
  const operationsChanged: string[] = []
  const operationsRelocated: string[] = []
  for (const [id, operation] of previousOperations) {
    const candidate = nextOperations.get(id)
    if (candidate === undefined) continue
    if (operation.method !== candidate.method || operation.path !== candidate.path) operationsRelocated.push(id)
    const previousOpenapi = previousOpenapiOperations.get(id)
    const nextOpenapi = nextOpenapiOperations.get(id)
    if (
      stable(operation) !== stable(candidate) ||
      previousOpenapi === undefined ||
      nextOpenapi === undefined ||
      stable(previousOpenapi.contract) !== stable(nextOpenapi.contract)
    ) {
      operationsChanged.push(id)
    }
  }
  const changed = new Set([
    ...operationsChanged,
    ...operationsRelocated,
    ...sortedDifference(previousOperations.keys(), new Set(nextOperations.keys())),
    ...policyAffectedOperations,
  ])
  const errorCatalogChanged = stable(previous.errorCatalog) !== stable(next.errorCatalog)
  return {
    methodsAdded: sortedDifference(nextMethods.keys(), new Set(previousMethods.keys())),
    methodsRemoved: sortedDifference(previousMethods.keys(), new Set(nextMethods.keys())),
    methodPoliciesChanged: methodPoliciesChanged.sort(),
    errorCatalogChanged,
    operationsAdded: sortedDifference(nextOperations.keys(), new Set(previousOperations.keys())),
    operationsRemoved: sortedDifference(previousOperations.keys(), new Set(nextOperations.keys())),
    operationsChanged: operationsChanged.sort(),
    operationsRelocated: operationsRelocated.sort(),
    implementedAffected: surface.methods
      .filter((operation) => errorCatalogChanged || changed.has(operation.operation_id))
      .map((operation) => operation.public_name)
      .sort(),
  }
}

const get = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "polygres-sdk-effect-contract-refresh",
      ...(process.env.GITHUB_TOKEN === undefined ? {} : { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  })
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

const resolveRef = async (ref: string): Promise<string> => {
  if (commitPattern.test(ref)) return ref
  const bytes = await get(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`)
  const payload = parseJson(bytes, "GitHub commit response")
  if (!isObject(payload) || typeof payload.sha !== "string" || !commitPattern.test(payload.sha)) {
    throw new Error(`GitHub did not resolve ${ref} to an immutable commit`)
  }
  return payload.sha
}

const trackingRef = (ref: string): string => {
  if (commitPattern.test(ref) || ref.startsWith("refs/")) return validateTrackingRef(ref)
  return validateTrackingRef(ref.startsWith("polygres-sdk-v") ? `refs/tags/${ref}` : `refs/heads/${ref}`)
}

export const fetchBundle = async (ref: string, surface: Surface): Promise<ContractBundle> => {
  const commit = await resolveRef(ref)
  const entries = await Promise.all(
    Object.entries(artifactSources).map(async ([name, source]) => {
      const url = `https://raw.githubusercontent.com/${repository}/${commit}/${source}`
      return [name, await get(url)] as const
    }),
  )
  return validateBundle({
    commit,
    trackingRef: trackingRef(ref),
    bytes: Object.fromEntries(entries) as Record<ArtifactName, Uint8Array>,
    surface,
  })
}

export const createLock = (bundle: ContractBundle): Lock => ({
  schema_version: 1,
  repository: repositoryUrl,
  tracking_ref: bundle.trackingRef,
  resolved_commit: bundle.commit,
  sdk_version: bundle.manifest.sdk_version,
  artifacts: Object.fromEntries(
    Object.entries(artifactSources).map(([name, source]) => [
      name,
      { source, sha256: sha256(bundle.bytes[name as ArtifactName]) },
    ]),
  ) as Lock["artifacts"],
})

export const assertSurfaceCompatibility = (surface: Surface, bundle: ContractBundle): void => {
  if (surface.default_api_version !== bundle.manifest.default_api_version) {
    throw new Error(
      `API version mismatch: Effect=${surface.default_api_version}, upstream=${bundle.manifest.default_api_version}`,
    )
  }
  if (compareSemver(surface.upstream_sdk_version, bundle.manifest.sdk_version) > 0) {
    throw new Error(
      `Effect surface SDK baseline ${surface.upstream_sdk_version} is newer than locked SDK ${bundle.manifest.sdk_version}`,
    )
  }
}

export const readLocal = async (root: string, surfaceValue: unknown, lockValue: unknown): Promise<ContractBundle> => {
  const surface = validateSurface(surfaceValue)
  const lock = validateLock(lockValue)
  const bytes = Object.fromEntries(
    await Promise.all(
      Object.keys(artifactSources).map(async (name) => [
        name,
        new Uint8Array(await readFile(join(root, "contracts", name))),
      ]),
    ),
  ) as Record<ArtifactName, Uint8Array>
  for (const name of Object.keys(artifactSources) as ReadonlyArray<ArtifactName>) {
    const actual = sha256(bytes[name])
    if (lock.artifacts[name].sha256 !== actual) throw new Error(`${name} does not match upstream-v1.lock.json`)
  }
  const bundle = validateBundle({ commit: lock.resolved_commit, trackingRef: lock.tracking_ref, bytes, surface })
  if (bundle.manifest.sdk_version !== lock.sdk_version) {
    throw new Error(`SDK version mismatch: manifest=${bundle.manifest.sdk_version}, lock=${lock.sdk_version}`)
  }
  assertSurfaceCompatibility(surface, bundle)
  const operations = manifestOperationIndex(bundle.manifest)
  for (const operation of surface.methods) {
    const upstream = operations.get(operation.operation_id)
    if (upstream === undefined || upstream.method !== operation.method || upstream.path !== operation.path) {
      throw new Error(`${operation.public_name} does not match locked operation ${operation.operation_id}`)
    }
  }
  return bundle
}

export const makeReport = (
  status: ContractReport["status"],
  previous: ContractBundle,
  next: ContractBundle,
  surface: Surface,
): ContractReport => {
  const changes = analyzeContracts(previous, next, surface)
  const snapshotsChanged = (Object.keys(artifactSources) as ReadonlyArray<ArtifactName>).some(
    (name) => sha256(previous.bytes[name]) !== sha256(next.bytes[name]),
  )
  return {
    status,
    source: {
      repository: repositoryUrl,
      previousCommit: previous.commit,
      resolvedCommit: next.commit,
      trackingRef: next.trackingRef,
    },
    versions: {
      previousSdk: previous.manifest.sdk_version,
      nextSdk: next.manifest.sdk_version,
      previousApi: previous.manifest.default_api_version,
      nextApi: next.manifest.default_api_version,
    },
    changes,
    requiresImplementation: changes.implementedAffected.length > 0,
    snapshotsChanged,
  }
}

export const renderPrompt = (report: ContractReport): string => {
  if (!report.snapshotsChanged) return "The pinned Polygres contracts are current."
  const lines = [
    `Update the Effect SDK for Polygres contract drift from ${report.source.previousCommit} to ${report.source.resolvedCommit} (SDK ${report.versions.previousSdk} -> ${report.versions.nextSdk}, API ${report.versions.previousApi} -> ${report.versions.nextApi}).`,
    "",
    "Required:",
  ]
  if (report.changes.implementedAffected.length === 0) {
    lines.push(
      "- Review and commit the refreshed contract snapshots and integrity lock; no implemented operation changed.",
    )
  } else {
    for (const name of report.changes.implementedAffected)
      lines.push(`- Reconcile and test implemented operation \`${name}\`.`)
  }
  if (report.changes.errorCatalogChanged) {
    lines.push("- Reconcile canonical error messages, statuses, variants, safe details, and classifications.")
  }
  lines.push("- Add focused schema, request, response, retry, and pagination tests for every affected operation.")
  lines.push("- Run `bun run check` and `bun run contracts:refresh -- check`.")
  if (report.changes.methodsAdded.length > 0) {
    lines.push("", "Candidates:")
    for (const name of report.changes.methodsAdded)
      lines.push(`- Evaluate upstream method \`${name}\` for the SDK roadmap.`)
  }
  lines.push(
    "",
    "Do not edit downloaded snapshots manually or weaken existing storage, transport, or error boundaries.",
  )
  return lines.join("\n")
}

const renderHuman = (report: ContractReport): string => {
  const summary = report.snapshotsChanged
    ? `Contract drift detected at ${report.source.resolvedCommit} (SDK ${report.versions.nextSdk}).`
    : `Contracts are current at ${report.source.previousCommit} (SDK ${report.versions.previousSdk}).`
  if (!report.snapshotsChanged) return summary
  return `${summary}\n\n${renderPrompt(report)}`
}

export const withContractLock = async <A>(root: string, task: () => Promise<A>): Promise<A> => {
  const lockDirectory = join(root, "contracts", ".contract-refresh.lock")
  try {
    await mkdir(lockDirectory)
  } catch (cause) {
    if (isObject(cause) && cause.code === "EEXIST") {
      throw new Error(`Contract files are locked by another process: ${lockDirectory}`)
    }
    throw cause
  }
  try {
    return await task()
  } finally {
    await rm(lockDirectory, { recursive: true, force: true })
  }
}

export const writeBundle = async (
  root: string,
  bundle: ContractBundle,
  surface: Surface,
  expectedLock: Lock,
): Promise<void> =>
  withContractLock(root, async () => {
    const contractsDirectory = join(root, "contracts")
    const currentLock = validateLock(
      parseJson(
        new Uint8Array(await readFile(join(contractsDirectory, "upstream-v1.lock.json"))),
        "upstream-v1.lock.json",
      ),
    )
    if (JSON.stringify(currentLock) !== JSON.stringify(validateLock(expectedLock))) {
      throw new Error("Contract lock changed while refresh was running")
    }
    await readLocal(root, surface, currentLock)

    const stagingDirectory = await mkdtemp(join(contractsDirectory, ".contract-refresh-stage-"))
    const writes = [
      ...Object.entries(bundle.bytes).map(([name, bytes]) => ({ name, bytes })),
      {
        name: "upstream-v1.lock.json",
        bytes: new TextEncoder().encode(`${JSON.stringify(createLock(bundle), null, 2)}\n`),
      },
    ]
    const states = writes.map(({ name }) => ({
      name,
      path: join(contractsDirectory, name),
      candidate: join(stagingDirectory, `candidate-${name}`),
      backup: join(stagingDirectory, `backup-${name}`),
      backedUp: false,
      installed: false,
    }))
    let preserveStaging = false
    try {
      await Promise.all(
        states.map((state, index) => writeFile(state.candidate, writes[index]?.bytes ?? new Uint8Array())),
      )
      for (const state of states) {
        await rename(state.path, state.backup)
        state.backedUp = true
        await rename(state.candidate, state.path)
        state.installed = true
      }
    } catch (cause) {
      const rollbackFailures: string[] = []
      for (const state of [...states].reverse()) {
        try {
          if (state.installed) await rm(state.path, { force: true })
          if (state.backedUp) await rename(state.backup, state.path)
        } catch (rollbackCause) {
          rollbackFailures.push(
            `${state.name}: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`,
          )
        }
      }
      if (rollbackFailures.length > 0) {
        preserveStaging = true
        throw new Error(
          `Contract update failed and rollback was incomplete; recovery files remain in ${stagingDirectory}: ${rollbackFailures.join("; ")}`,
          { cause },
        )
      }
      throw new Error("Contract update failed; previous files were restored", { cause })
    } finally {
      if (!preserveStaging) await rm(stagingDirectory, { recursive: true, force: true })
    }
  })

const usage = "Usage: contracts:refresh -- check|update [--ref REF] [--format human|json|prompt] [--allow-downgrade]"

const validateInputRef = (value: string): string => {
  if (value.startsWith("refs/")) validateTrackingRef(value)
  else if (
    !commitPattern.test(value) &&
    (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
      value.includes("..") ||
      value.includes("//") ||
      value.endsWith("/") ||
      value.endsWith("."))
  ) {
    throw new Error(`Invalid ref: ${value}`)
  }
  return value
}

export const parseArguments = (argv: ReadonlyArray<string>) => {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv]
  const command = args[0]
  if (command !== "check" && command !== "update") throw new Error(usage)
  let ref = "main"
  let format = "human"
  let allowDowngrade = false
  const seen = new Set<string>()
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== "--ref" && argument !== "--format" && argument !== "--allow-downgrade") {
      throw new Error(`Unknown argument: ${argument}\n${usage}`)
    }
    if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}`)
    seen.add(argument)
    if (argument === "--allow-downgrade") {
      allowDowngrade = true
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}`)
    index += 1
    if (argument === "--ref") ref = validateInputRef(value)
    else format = value
  }
  if (format !== "human" && format !== "json" && format !== "prompt") {
    throw new Error(`Unsupported format: ${format}`)
  }
  return { command, ref, format, allowDowngrade } as const
}

const readJsonFile = async (path: string, name: string): Promise<unknown> =>
  parseJson(new Uint8Array(await readFile(path)), name)

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const root = join(import.meta.dir, "..")
  const surface = validateSurface(
    await readJsonFile(join(root, "contracts", "effect-sdk-v1.surface.json"), "effect-sdk-v1.surface.json"),
  )
  const lock = validateLock(
    await readJsonFile(join(root, "contracts", "upstream-v1.lock.json"), "upstream-v1.lock.json"),
  )
  const previous = await withContractLock(root, () => readLocal(root, surface, lock))
  const next = await fetchBundle(options.ref, surface)
  if (!options.allowDowngrade && compareSemver(next.manifest.sdk_version, previous.manifest.sdk_version) < 0) {
    throw new Error(`Refusing SDK downgrade ${previous.manifest.sdk_version} -> ${next.manifest.sdk_version}`)
  }
  if (compareSemver(next.manifest.sdk_version, surface.upstream_sdk_version) < 0) {
    throw new Error(
      `Refusing SDK ${next.manifest.sdk_version}: it predates Effect surface baseline ${surface.upstream_sdk_version}`,
    )
  }
  let report = makeReport(next.commit === previous.commit ? "current" : "drift", previous, next, surface)
  if (!report.snapshotsChanged) report = { ...report, status: "current" }
  if (options.command === "update" && report.snapshotsChanged) {
    await writeBundle(root, next, surface, lock)
    report = { ...report, status: "updated" }
    const verification = Bun.spawnSync(["bun", "run", "contracts:check"], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    })
    if (verification.exitCode !== 0) report = { ...report, requiresImplementation: true }
  }
  const output =
    options.format === "json"
      ? JSON.stringify(report, null, 2)
      : options.format === "prompt"
        ? renderPrompt(report)
        : renderHuman(report)
  console.log(output)
  if (options.command === "check" && report.snapshotsChanged) process.exitCode = 1
  if (report.requiresImplementation) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 2
  })
}
