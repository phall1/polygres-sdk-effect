import { expect, test } from "bun:test"
import { Effect, Option, Stream } from "effect"

import { Page } from "../src/index.js"

test("page operations stop on absent and empty cursors", async () => {
  for (const nextCursor of [Option.none<string>(), Option.some("")]) {
    let calls = 0
    const operation = Page.makeOperation<{ readonly cursor?: string }, number>(() => {
      calls++
      return Effect.succeed({
        items: [1],
        nextCursor: Option.filter(nextCursor, (cursor) => cursor.length > 0),
        hasMore: true,
        requestId: Option.none(),
        metadata: {},
      })
    })
    const values = await operation.stream({}).pipe(Stream.runCollect, Effect.runPromise)

    expect(Array.from(values)).toEqual([1])
    expect(calls).toBe(1)
  }
})

test("streams discard a cursor hidden in a structurally wider input", async () => {
  const observed: Array<string | undefined> = []
  const operation = Page.makeOperation<{ readonly value: number; readonly cursor?: string }, number>((input) => {
    observed.push(input.cursor)
    return Effect.succeed({
      items: [input.value],
      nextCursor: Option.none(),
      hasMore: false,
      requestId: Option.none(),
      metadata: {},
    })
  })
  const wider = { value: 1, cursor: "must-not-be-used" }
  const values = await operation.stream(wider).pipe(Stream.runCollect, Effect.runPromise)

  expect(Array.from(values)).toEqual([1])
  expect(observed).toEqual([undefined])
})
