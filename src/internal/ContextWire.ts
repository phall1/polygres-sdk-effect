import { Option, Schema } from "effect"

type Decodable<A> = Schema.Schema<A> & { readonly DecodingServices: never }

const integerFields = new Set([
  "activePoints",
  "alreadyAbsent",
  "alreadyActive",
  "aligned",
  "attempts",
  "batchNumber",
  "baselineRank",
  "candidateBudget",
  "candidateCount",
  "candidatesPerQuery",
  "collectionId",
  "combinedCandidates",
  "compatibilityGeneration",
  "count",
  "deadTableTuples",
  "deferred",
  "deleted",
  "deletedCount",
  "deletedPoints",
  "dimensions",
  "depth",
  "estimatedCandidates",
  "estimatedIndexTuples",
  "estimatedRows",
  "exactCount",
  "explicitSeeds",
  "filterFields",
  "graphCandidates",
  "graphLimit",
  "groupRank",
  "hnswIndexes",
  "httpStatus",
  "indexPages",
  "inserted",
  "insertedCount",
  "intersectionCount",
  "k",
  "lexicalCandidates",
  "limit",
  "linkBytes",
  "managedEquivalent",
  "mappedPointCount",
  "maxCandidateBudget",
  "maxContextLimit",
  "maxDimensions",
  "maxFilterBytes",
  "maxFilterDepth",
  "maxFilterNodes",
  "maxFilterValues",
  "maxGraphDepth",
  "maxGraphLimit",
  "maxIndexMemoryBytes",
  "maxJointSeedLimit",
  "maxJointTraversalLimit",
  "maxPointKeysPerOperation",
  "maxPoints",
  "maxReconcilePointKeys",
  "maxRelationshipTypes",
  "maxResultColumns",
  "maxSearchLimit",
  "maxValuesPerMatch",
  "maxVectors",
  "migrationId",
  "missingCount",
  "missingSdk",
  "ordinalPosition",
  "partial",
  "pointId",
  "postgresMajor",
  "processed",
  "processedCount",
  "processedPoints",
  "processedUnits",
  "queryCount",
  "queryTimeoutMs",
  "rank",
  "rankLift",
  "reactivated",
  "reactivatedCount",
  "registeredVectors",
  "rescoredCandidates",
  "retainedSeeds",
  "retrievalSeeds",
  "rrfK",
  "seedLimit",
  "semanticCandidates",
  "sqlOnly",
  "stableItems",
  "totalBytes",
  "totalCandidates",
  "totalExpansions",
  "totalFilterCandidates",
  "totalPoints",
  "totalRechecks",
  "totalResults",
  "totalRowsPruned",
  "totalRowsRechecked",
  "totalStages",
  "totalUnits",
  "totalVisits",
  "traversalLimit",
  "vectorBytes",
])

const finiteFields = new Set([
  "avgLatencyMs",
  "avgRecallAchieved",
  "avgRecallThreshold",
  "contextWeight",
  "graphWeight",
  "minimumRecall",
  "recall",
  "score",
  "semantic",
  "lexical",
  "graph",
  "total",
  "weight",
])

const booleanFields = new Set([
  "denseSearch",
  "dropped",
  "eligible",
  "facets",
  "graphFirst",
  "groupedSearch",
  "hasMore",
  "hasSourceTable",
  "isActive",
  "isDefault",
  "isLive",
  "isReady",
  "isValid",
  "joint",
  "nullable",
  "offerAcknowledged",
  "ownsIndex",
  "ownsSourceTable",
  "ownsVectorColumn",
  "pgcontextInstalled",
  "pgvectorInstalled",
  "pointScroll",
  "rankedSearchCursor",
  "rankFusion",
  "recallCheck",
  "sameColumnBridge",
  "setup",
  "sourceTableExists",
  "strictMode",
  "textHybrid",
  "introducedByGraph",
  "updated",
  "vectorFirst",
  "verified",
])

const pythonInteger = /^\s*[+-]?\d(?:_?\d)*\s*$/
const pythonFinite = /^\s*[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:e[+-]?\d(?:_?\d)*)?\s*$/i

const opaqueFields = new Set([
  "details",
  "hnswOptions",
  "jsonbFilterPaths",
  "normalizedRequest",
  "payload",
  "plannedActions",
  "properties",
  "quantizationOptions",
  "sourceIdentity",
  "warnings",
])

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase())
const snake = (key: string) => key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)

const normalizeScalar = (key: string, value: unknown, forceBoolean = false): unknown => {
  if (forceBoolean || booleanFields.has(key)) {
    if (value === 0 || value === 1) return value === 1
    if (typeof value === "string") {
      const normalized = value.toLowerCase()
      if (["1", "on", "t", "true", "y", "yes"].includes(normalized)) return true
      if (["0", "off", "f", "false", "n", "no"].includes(normalized)) return false
    }
  }
  if (typeof value !== "string") return value
  if (integerFields.has(key) && pythonInteger.test(value)) {
    const parsed = Number(value.replaceAll("_", ""))
    if (Number.isSafeInteger(parsed)) return parsed
  }
  if (finiteFields.has(key) && pythonFinite.test(value)) {
    const parsed = Number(value.replaceAll("_", ""))
    if (Number.isFinite(parsed)) return parsed
  }
  return value
}

const stripResultPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripResultPayload)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "result_payload")
      .map(([key, item]) => [key, stripResultPayload(item)]),
  )
}

const normalizeWireResponse = (value: unknown, key = ""): unknown => {
  if (Array.isArray(value)) return value.map((item) => normalizeWireResponse(item, key))
  if (value === null || typeof value !== "object") return normalizeScalar(key, value)
  const capabilities = Object.hasOwn(value, "contract_version") && Object.hasOwn(value, "runtime")
  return Object.fromEntries(
    Object.entries(value).map(([wireKey, item]) => {
      const domainKey = camel(wireKey)
      return [
        domainKey,
        opaqueFields.has(domainKey)
          ? item
          : item === null || typeof item !== "object"
            ? normalizeScalar(domainKey, item, capabilities && domainKey === "count")
            : normalizeWireResponse(item, domainKey),
      ]
    }),
  )
}

const responseFields = new Set([
  ...integerFields,
  ...finiteFields,
  ...booleanFields,
  ...opaqueFields,
  "activeOperation",
  "collection",
  "collections",
  "columns",
  "createdAt",
  "error",
  "finishedAt",
  "fusion",
  "graph",
  "lastReconciledAt",
  "lexical",
  "nextCursor",
  "operation",
  "operations",
  "requestId",
  "results",
  "retryUntil",
  "scoreBreakdown",
  "startedAt",
  "trace",
  "updatedAt",
  "vectors",
])

export const normalizeResponse = (value: unknown, key = ""): unknown => {
  if (Array.isArray(value)) return value.map((item) => normalizeResponse(item, key))
  if (value === null || typeof value !== "object") return normalizeScalar(key, value)
  const capabilities = Object.hasOwn(value, "contract_version") && Object.hasOwn(value, "runtime")
  return Object.fromEntries(
    Object.entries(value)
      .filter(([wireKey]) => wireKey !== "result_payload")
      .map(([wireKey, item]) => {
        const domainKey = camel(wireKey)
        if (!responseFields.has(domainKey)) return [wireKey, stripResultPayload(item)]
        return [
          domainKey,
          opaqueFields.has(domainKey)
            ? stripResultPayload(item)
            : item === null || typeof item !== "object"
              ? normalizeScalar(domainKey, item, capabilities && domainKey === "count")
              : normalizeResponse(item, domainKey),
        ]
      }),
  )
}

const mergeAdditiveFields = (decoded: unknown, wire: unknown, key = ""): unknown => {
  if (opaqueFields.has(key)) return wire
  if (Array.isArray(decoded) && Array.isArray(wire)) {
    return decoded.map((item, index) => mergeAdditiveFields(item, wire[index], key))
  }
  if (Option.isOption(decoded)) {
    return Option.isSome(decoded) ? Option.some(mergeAdditiveFields(decoded.value, wire, key)) : decoded
  }
  if (decoded === null || typeof decoded !== "object" || wire === null || typeof wire !== "object") return decoded

  const output: Record<string, unknown> = { ...(decoded as Record<string, unknown>) }
  for (const [wireKey, item] of Object.entries(wire)) {
    const domainKey = camel(wireKey)
    if (Object.hasOwn(output, domainKey) && (wireKey === domainKey || wireKey === snake(domainKey))) {
      output[domainKey] = mergeAdditiveFields(output[domainKey], item, domainKey)
    } else {
      output[wireKey] = item
    }
  }
  return output
}

export const decodeResponse = <A>(schema: Decodable<A>, payload: unknown): A => {
  const wire = stripResultPayload(payload)
  const decoded = Schema.decodeUnknownSync(schema)(normalizeWireResponse(wire))
  return mergeAdditiveFields(decoded, wire) as A
}

const uniqueStrings = (values: ReadonlyArray<unknown>) => {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (typeof value !== "string" || seen.has(value)) return typeof value !== "string"
    seen.add(value)
    return true
  })
}

const uniqueStarts = (values: ReadonlyArray<unknown>) => {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (value === null || typeof value !== "object") return true
    const start = value as { readonly schema?: unknown; readonly table?: unknown; readonly id?: unknown }
    const identity = JSON.stringify([start.schema, start.table, start.id])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

const normalizeRequest = (value: unknown, key = ""): unknown => {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeRequest(item, key))
    if (key === "sourceKeys" || key === "schemaNames" || key === "relationshipTypes") return uniqueStrings(normalized)
    if (key === "starts") return uniqueStarts(normalized)
    return normalized
  }
  if (value === null || typeof value !== "object") return value
  const queryPlan = typeof (value as { readonly kind?: unknown }).kind === "string"
  return Object.fromEntries(
    Object.entries(value).map(([domainKey, item]) => [
      snake(domainKey),
      opaqueFields.has(domainKey) || (queryPlan && domainKey === "filter") ? item : normalizeRequest(item, domainKey),
    ]),
  )
}

export const encodeRequest = <A>(schema: Decodable<A>, value: unknown): unknown => {
  const validated = Schema.decodeUnknownSync(schema)(value)
  assertNoExcessProperties(value, validated)
  return normalizeRequest(validated)
}

const assertNoExcessProperties = (input: unknown, decoded: unknown): void => {
  if (Array.isArray(input) && Array.isArray(decoded)) {
    for (let index = 0; index < input.length; index += 1) assertNoExcessProperties(input[index], decoded[index])
    return
  }
  if (Option.isOption(decoded)) {
    if (Option.isSome(decoded)) assertNoExcessProperties(input, decoded.value)
    return
  }
  if (input === null || typeof input !== "object" || decoded === null || typeof decoded !== "object") return
  for (const [key, item] of Object.entries(input)) {
    if (!Object.hasOwn(decoded, key)) throw new Error(`Expected no excess property at ${key}`)
    assertNoExcessProperties(item, (decoded as Record<string, unknown>)[key])
  }
}
