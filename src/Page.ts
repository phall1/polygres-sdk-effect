import { Effect, Option, Schema, Stream } from "effect"
import { JsonObject } from "./Entity.js"
import type * as PolygresError from "./PolygresError.js"

export const Value = <A extends Schema.Top>(item: A) =>
  Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.Option(Schema.String),
    hasMore: Schema.Boolean,
    requestId: Schema.Option(Schema.String),
    metadata: JsonObject,
  })

export interface Value<A> {
  readonly items: ReadonlyArray<A>
  readonly nextCursor: Option.Option<string>
  readonly hasMore: boolean
  readonly requestId: Option.Option<string>
  readonly metadata: Schema.Schema.Type<typeof JsonObject>
}

export type WithoutCursor<Input> = Omit<Input, "cursor">

export interface Operation<Input extends { readonly cursor?: string }, Item, Error = PolygresError.Search> {
  readonly page: (input: Input) => Effect.Effect<Value<Item>, Error>
  readonly stream: (input: WithoutCursor<Input>) => Stream.Stream<Item, Error>
}

export const makeOperation = <Input extends { readonly cursor?: string }, Item, Error = PolygresError.Search>(
  page: (input: Input) => Effect.Effect<Value<Item>, Error>,
): Operation<Input, Item, Error> => ({
  page,
  stream: (input) => {
    const { cursor: _ignored, ...initial } = input as Input
    return Stream.paginate<string | undefined, Item, Error>(undefined, (cursor) =>
      page({ ...initial, ...(cursor === undefined ? {} : { cursor }) } as Input).pipe(
        Effect.map(
          (value) =>
            [
              value.items,
              value.hasMore ? Option.filter(value.nextCursor, (next) => next.length > 0) : Option.none(),
            ] as const,
        ),
      ),
    )
  },
})
