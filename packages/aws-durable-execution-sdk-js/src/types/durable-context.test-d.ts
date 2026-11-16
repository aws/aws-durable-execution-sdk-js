// Type-level tests for the generic DurableContext API.
//
// `tsc --noEmit` (`npm run typecheck`) checks this file. Vitest does not run
// it: nothing here executes, and `ctx` below exists only as a type.
// A failing `expectTypeOf` or an unused `@ts-expect-error` fails the typecheck.

import { expectTypeOf } from "vitest";
import type {
  BatchResult,
  DurableContext,
  DurableContextLogger,
  DurableLogger,
  DurablePromise,
} from "../index";

declare const ctx: DurableContext;

interface User {
  id: string;
  age: number;
}

declare const users: User[];

// step

expectTypeOf(ctx.step(async () => 42)).toEqualTypeOf<DurablePromise<number>>();
expectTypeOf(ctx.step("name", async () => "a")).toEqualTypeOf<
  DurablePromise<string>
>();
expectTypeOf(ctx.step(undefined, async () => true)).toEqualTypeOf<
  DurablePromise<boolean>
>();
expectTypeOf(await ctx.step(async () => ({ ok: true }))).toEqualTypeOf<{
  ok: boolean;
}>();

ctx.step(async (stepCtx) => {
  expectTypeOf(stepCtx.attempt).toBeNumber();
  return 1;
});

// The serdes type follows the step output.
ctx.step(async () => 1, {
  serdes: {
    serialize: async (value) => {
      expectTypeOf(value).toEqualTypeOf<number | undefined>();
      return "";
    },
    deserialize: async () => 1,
  },
});

// @ts-expect-error The function result must match the explicit type argument.
ctx.step<number>(async () => "not a number");

// map

const mapped = ctx.map(users, async (_child, item, index, array) => {
  expectTypeOf(item).toEqualTypeOf<User>();
  expectTypeOf(index).toBeNumber();
  expectTypeOf(array).toEqualTypeOf<User[]>();
  return item.age;
});
expectTypeOf(mapped).toEqualTypeOf<DurablePromise<BatchResult<number>>>();
expectTypeOf((await mapped).getResults()).toEqualTypeOf<number[]>();

expectTypeOf(
  ctx.map("named", users, async (_child, item) => item.id),
).toEqualTypeOf<DurablePromise<BatchResult<string>>>();

ctx.map(users, async (_child, item) => item.id, {
  itemNamer: (item, index) => {
    expectTypeOf(item).toEqualTypeOf<User>();
    expectTypeOf(index).toBeNumber();
    return item.id;
  },
});

ctx.map(users, async (_child, item) => item.id, {
  // @ts-expect-error itemNamer gets the item type, and User has no `name`.
  itemNamer: (item) => item.name,
});

// @ts-expect-error The map function result must match the explicit type argument.
ctx.map<User, number>(users, async (_child, item) => item.id);

// parallel

// One branch type: the explicit type argument checks every branch.
expectTypeOf(
  ctx.parallel<number>([async () => 1, { name: "two", func: async () => 2 }]),
).toEqualTypeOf<DurablePromise<BatchResult<number>>>();

// @ts-expect-error Every branch must return the explicit type argument.
ctx.parallel<number>([async () => 1, async () => "two"]);

// Mixed branch types: the result type is the union of the branch results.
const mixed = ctx.parallel([async () => 1, async () => "two"] as const);
expectTypeOf(mixed).toEqualTypeOf<
  DurablePromise<BatchResult<number | string>>
>();
expectTypeOf((await mixed).getResults()).toEqualTypeOf<(number | string)[]>();

expectTypeOf(
  ctx.parallel("named", [async () => 1, async () => "two"] as const),
).toEqualTypeOf<DurablePromise<BatchResult<number | string>>>();

expectTypeOf(
  ctx.parallel("named", [
    { name: "a", func: async () => 1 },
    { name: "b", func: async () => 2 },
  ] as const),
).toEqualTypeOf<DurablePromise<BatchResult<number>>>();

// waitForCondition

const polled = ctx.waitForCondition(
  async (state, conditionCtx) => {
    expectTypeOf(state).toEqualTypeOf<{ status: string; ready: boolean }>();
    expectTypeOf(conditionCtx.attempt).toBeNumber();
    return { ...state, ready: true };
  },
  {
    initialState: { status: "pending", ready: false },
    waitStrategy: (state, attempt) => {
      expectTypeOf(state).toEqualTypeOf<{ status: string; ready: boolean }>();
      expectTypeOf(attempt).toBeNumber();
      return state.ready
        ? { shouldContinue: false }
        : { shouldContinue: true, delay: { seconds: 5 } };
    },
  },
);
expectTypeOf(polled).toEqualTypeOf<
  DurablePromise<{ status: string; ready: boolean }>
>();

expectTypeOf(
  ctx.waitForCondition("named", async (state: number) => state + 1, {
    initialState: 0,
    waitStrategy: () => ({ shouldContinue: false }),
  }),
).toEqualTypeOf<DurablePromise<number>>();

ctx.waitForCondition<number>(
  // @ts-expect-error The check function must return the state type.
  async () => "done",
  {
    initialState: 0,
    waitStrategy: () => ({ shouldContinue: false }),
  },
);

ctx.waitForCondition(async (state: number) => state, {
  initialState: 0,
  // @ts-expect-error A decision to continue needs a delay.
  waitStrategy: () => ({ shouldContinue: true }),
});

// A custom logger type reaches the contexts that the operations pass in.
// Contexts expose only the standard log methods of that logger.

interface AppLogger extends DurableLogger {
  info(message: string, fields: { requestId: string }): void;
  audit(message: string): void;
}

declare const appCtx: DurableContext<AppLogger>;

appCtx.step(async (stepCtx) => {
  expectTypeOf(stepCtx.logger).toEqualTypeOf<DurableContextLogger<AppLogger>>();
  expectTypeOf(stepCtx.logger.info).toEqualTypeOf<AppLogger["info"]>();
  // @ts-expect-error A context logger has no custom methods.
  stepCtx.logger.audit("x");
});

appCtx.map(users, async (child) => {
  expectTypeOf(child).toEqualTypeOf<DurableContext<AppLogger>>();
});

appCtx.parallel<void>([
  async (child) => {
    expectTypeOf(child).toEqualTypeOf<DurableContext<AppLogger>>();
  },
]);
