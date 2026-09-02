import { expect, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"

import { parsePythonErrorCatalog } from "../scripts/parse-error-catalog.js"
import { catalog } from "../src/internal/ErrorCatalog.js"

test("generated error lookup exactly matches the inert pinned Python catalog", async () => {
  const source = await Bun.file(new URL("../contracts/python-sdk-v1.errors.py", import.meta.url)).text()
  const parsed = parsePythonErrorCatalog(source)

  expect(Object.keys(parsed)).toHaveLength(688)
  expect(isDeepStrictEqual(parsed, catalog)).toBe(true)
})

test("error catalog parser rejects executable Python expressions", () => {
  expect(() =>
    parsePythonErrorCatalog("ERROR_CATALOG_DATA = tuple([__import__('os').system('echo unsafe')])\n"),
  ).toThrow("Unsupported Python literal")
})
