import { Effect, Option, Stream } from "effect"

import type { ResultPage } from "./schemas.js"

export const paginate = <A, E, R>(
  fetchPage: (cursor?: string) => Effect.Effect<ResultPage<A>, E, R>,
): Stream.Stream<A, E, R> =>
  Stream.paginate<string | undefined, A, E, R>(undefined, (cursor) =>
    fetchPage(cursor).pipe(
      Effect.map(
        (page) =>
          [
            page.results,
            page.hasMore && page.nextCursor !== null ? Option.some(page.nextCursor) : Option.none<string>(),
          ] as const,
      ),
    ),
  )
