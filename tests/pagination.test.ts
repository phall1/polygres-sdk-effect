import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"

import { paginate } from "../src/index.js"

test("paginate follows cursors lazily", async () => {
  const cursors: Array<string | undefined> = []
  const stream = paginate((cursor) => {
    cursors.push(cursor)
    return Effect.succeed(
      cursor === undefined
        ? { results: [1, 2], nextCursor: "second", hasMore: true }
        : { results: [3], nextCursor: null, hasMore: false },
    )
  })

  const values = await stream.pipe(Stream.runCollect, Effect.runPromise)

  expect(Array.from(values)).toEqual([1, 2, 3])
  expect(cursors).toEqual([undefined, "second"])
})
