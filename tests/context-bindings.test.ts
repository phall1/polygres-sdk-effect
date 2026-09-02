import { expect, test } from "bun:test"

import { type ContextBinding, contextBindings } from "../src/internal/ContextBindings.js"

interface ManifestOperation {
  readonly method: string
  readonly operation_id: string
  readonly path: string
  readonly request_schema: string | ReadonlyArray<string> | null
}

interface ManifestMethod {
  readonly binding_kind: "composite" | "local" | "operation"
  readonly operation_ids: ReadonlyArray<string>
  readonly operations: ReadonlyArray<ManifestOperation>
  readonly pagination: "auto_cursor" | "none"
  readonly public_name: string
  readonly retry_policy: "idempotent_mutation" | "none" | "polling" | "read_only_get" | "read_only_post"
}

const manifest = JSON.parse(
  await Bun.file(new URL("../contracts/python-sdk-v1.methods.json", import.meta.url)).text(),
) as { readonly methods: ReadonlyArray<ManifestMethod> }

const methods = manifest.methods.filter(({ public_name }) => public_name.startsWith("project.context."))

const camelCase = (value: string): string => value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())

const publicName = ({ public_name }: ManifestMethod): string => camelCase(public_name.slice("project.context.".length))

const retryPolicy = {
  idempotent_mutation: "idempotentMutation",
  none: "never",
  polling: "polling",
  read_only_get: "readOnlyGet",
  read_only_post: "readOnlyPost",
} as const

const expectedBinding = (method: ManifestMethod): ContextBinding => {
  if (method.binding_kind === "local") return { kind: "local", publicName: publicName(method) }

  const operation = method.operations[0]
  if (operation === undefined || method.operations.length !== 1 || method.operation_ids.length !== 1) {
    throw new Error(`Expected exactly one operation for ${method.public_name}`)
  }

  const network = {
    publicName: publicName(method),
    operationId: operation.operation_id,
    method: operation.method,
    path: operation.path,
    pagination: method.pagination === "auto_cursor" ? "cursor" : "none",
    requestBody: operation.request_schema === null ? "none" : "required",
  } as const

  if (method.binding_kind === "composite") {
    return { kind: "composite", ...network, retryPolicy: retryPolicy[method.retry_policy] } as ContextBinding
  }
  return { kind: "operation", ...network, retryPolicy: retryPolicy[method.retry_policy] } as ContextBinding
}

const byPublicName = (bindings: ReadonlyArray<ContextBinding>): ReadonlyArray<ContextBinding> =>
  [...bindings].sort((left, right) => left.publicName.localeCompare(right.publicName))

const groupBy = <A>(items: ReadonlyArray<A>, keyOf: (item: A) => string): Map<string, Array<A>> => {
  const groups = new Map<string, Array<A>>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [item])
    else group.push(item)
  }
  return groups
}

test("Context bindings exactly match all pinned public methods", () => {
  expect(methods).toHaveLength(96)
  expect(contextBindings).toHaveLength(96)
  expect(new Set(contextBindings.map(({ publicName }) => publicName)).size).toBe(96)
  expect(byPublicName(contextBindings)).toEqual(byPublicName(methods.map(expectedBinding)))
})

test("operation bindings preserve unique operations, aliases, policies, and pagination", () => {
  const bindings = contextBindings.filter((binding) => binding.kind === "operation")
  const manifestOperations = methods.filter((method) => method.binding_kind === "operation")

  expect(bindings).toHaveLength(83)
  expect(new Set(bindings.map(({ operationId }) => operationId)).size).toBe(75)
  expect(
    bindings
      .filter(({ pagination }) => pagination === "cursor")
      .map(({ publicName }) => publicName)
      .sort(),
  ).toEqual(["listCollections", "listOperations", "scroll", "scrollPoints"])

  const aliases = groupBy(bindings, ({ operationId }) => operationId)
  const expectedAliases = groupBy(manifestOperations, ({ operation_ids, public_name }) => {
    const operationId = operation_ids[0]
    if (operationId === undefined) throw new Error(`Missing operation ID for ${public_name}`)
    return operationId
  })
  const aliasedOperationIds = [...expectedAliases]
    .filter(([, entries]) => entries.length > 1)
    .map(([operationId]) => operationId)
    .sort()

  expect(
    [...aliases]
      .filter(([, entries]) => entries.length > 1)
      .map(([operationId]) => operationId)
      .sort(),
  ).toEqual(aliasedOperationIds)
  for (const operationId of aliasedOperationIds) {
    const shared = aliases.get(operationId)
    expect(shared).toBeDefined()
    expect(new Set(shared?.map(({ publicName: _, ...binding }) => JSON.stringify(binding))).size).toBe(1)
  }
})

test("local query builders and polling composite retain their classifications", () => {
  const expectedLocals = methods
    .filter((method) => method.binding_kind === "local")
    .map(publicName)
    .sort()
  const actualLocals = contextBindings
    .filter((binding) => binding.kind === "local")
    .map(({ publicName }) => publicName)
    .sort()

  expect(actualLocals).toHaveLength(12)
  expect(actualLocals).toEqual(expectedLocals)
  expect(contextBindings.filter((binding) => binding.kind === "composite")).toEqual([
    {
      kind: "composite",
      publicName: "waitForOperation",
      operationId: "runtime_context_get_operation",
      method: "GET",
      path: "/v1/context/operations/{operation_id}",
      retryPolicy: "polling",
      pagination: "none",
      requestBody: "none",
    },
  ])
})

test("runtime registry has no imports or contract and filesystem references", async () => {
  const source = await Bun.file(new URL("../src/internal/ContextBindings.ts", import.meta.url)).text()

  expect(source).not.toMatch(/^\s*import\s/m)
  expect(source).not.toContain("node:")
  expect(source).not.toContain("Bun.")
  expect(source).not.toContain("contracts/")
})
