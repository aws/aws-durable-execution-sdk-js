import * as typescriptParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { requireDurableOperationInChildContext } from "./require-durable-operation-in-child-context";

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptParser },
});

/** Wraps a handler body in the usual withDurableExecution setup. */
const handler = (body: string, helpers = "") => `
  ${helpers}
  export const handler = withDurableExecution(async (event: any, context) => {
    ${body}
  });
`;

const error = (operation: string) => ({
  messageId: "noDurableOperation" as const,
  data: { operation },
});

ruleTester.run(
  "require-durable-operation-in-child-context",
  requireDurableOperationInChildContext,
  {
    valid: [
      // A durable operation on the child context.
      handler(`
        await context.runInChildContext("transform", async (ctx) =>
          ctx.step("compute", async () => cheapTransform(event)),
        );
      `),
      // The unnamed overload.
      handler(`
        await context.runInChildContext(async (ctx) => {
          await ctx.wait({ seconds: 1 });
        });
      `),
      // Each durable operation counts.
      ...[
        "ctx.invoke('f', 'arn', {})",
        "ctx.createCallback()",
        "ctx.waitForCallback(async () => {})",
        "ctx.waitForCondition(async () => 1, { waitStrategy })",
        "ctx.runInChildContext(async (c) => c.step(async () => 1))",
        "ctx.promise.all([])",
        "ctx?.step(async () => 1)",
        "ctx!.step(async () => 1)",
      ].map((call) =>
        handler(`await context.runInChildContext(async (ctx) => ${call});`),
      ),
      // A durable operation inside a nested closure.
      handler(`
        await context.runInChildContext(async (ctx) => {
          await Promise.all(items.map((item) => ctx.step(async () => item)));
        });
      `),
      // map and parallel with durable work.
      handler(`
        await context.map("transform", items, async (ctx, item) =>
          ctx.step(async () => cheapTransform(item)),
        );
        await context.map(items, async (ctx, item) => ctx.step(async () => item));
        await context.parallel("branches", [
          async (ctx) => ctx.step(async () => 1),
          { name: "b", func: async (ctx) => ctx.wait({ seconds: 1 }) },
        ]);
        await context.parallel([async (ctx) => ctx.step(async () => 1)] as const);
      `),
      // The context reaches a helper in the file that performs the operation,
      // through a function declaration, a const arrow, and two levels.
      handler(
        `
        await context.runInChildContext(async (ctx) => charge(ctx, event));
        await context.runInChildContext(async (ctx) => refund(event, ctx));
        await context.runInChildContext(async (ctx) => outer(ctx));
      `,
        `
        async function charge(c, e) { return c.step(async () => e); }
        const refund = async (e, c) => c.step(async () => e);
        const inner = (c) => c.wait({ seconds: 1 });
        const outer = (c) => inner(c);
      `,
      ),
      // A named function passed as the child-context function.
      handler(
        "await context.runInChildContext(process);",
        "async function process(c) { await c.step(async () => 1); }",
      ),
      // The context reaches code the rule cannot read, so it may be used there.
      ...[
        "importedHelper(ctx)",
        "service.run(ctx)",
        "new Worker(ctx)",
        "store.push(ctx)",
        "({ ctx })",
        "ctx",
        "ctx[method]()",
        "ctx()",
      ].map((use) =>
        handler(`await context.runInChildContext(async (ctx) => ${use});`),
      ),
      // A destructured or rest parameter.
      handler(`
        await context.runInChildContext(async ({ step }) => step(async () => 1));
        await context.runInChildContext(async (...args) => use(args));
      `),
      // A detached method is not tracked, so the rule stays silent.
      handler(`
        await context.runInChildContext(async (ctx) => {
          const step = ctx.step.bind(ctx);
          return step(async () => 1);
        });
      `),
      // A reassigned context parameter.
      handler(`
        await context.runInChildContext(async (ctx) => {
          ctx = other;
          return compute();
        });
      `),
      // A helper that is not a function the file declares once as a const.
      handler(
        "await context.runInChildContext(async (ctx) => helper(ctx));",
        "let helper = (c) => compute();",
      ),
      // Array.prototype.map, lodash map, and async parallel are not durable.
      handler(`
        items.map((item) => item * 2);
        _.map(items, (item, index) => item * index);
        async.parallel([(cb) => cb()]);
        other.map(items, async (a, b) => compute(a, b));
      `),
      // map and parallel on a receiver the rule cannot identify as a context.
      `
        async function run(ctx) {
          await ctx.map(items, async (c, item) => compute(item));
          await ctx.parallel([async (c) => compute()]);
        }
      `,
      // A child-context function the rule cannot read.
      handler("await context.runInChildContext(imported);"),
      // A rest parameter collects the context, so the rule does not follow it.
      handler(
        `await context.runInChildContext(async (ctx) => traced("charge", ctx));`,
        `import { impl } from "./impl";
        const traced = (...args: any[]) => impl(...args);`,
      ),
      handler(
        `await context.runInChildContext(async (ctx) => helper("tag", ctx));`,
        "const helper = async (...args: any[]) => args[1].step(async () => 1);",
      ),
      // A spread argument before the context hides its index.
      handler(
        "await context.runInChildContext(async (ctx) => helper(...pre, ctx));",
        "async function helper(c: any, d?: any) { return c.step(async () => 1); }",
      ),
      // A non-arrow function can read the context through `arguments`.
      handler(
        "await context.runInChildContext(async (ctx) => helper(ctx));",
        "async function helper() { return arguments[0].step(async () => 1); }",
      ),
      handler(`
        await context.runInChildContext(async function () {
          return arguments[0].step(async () => 1);
        });
      `),
      // A TypeScript this parameter receives no argument.
      handler(
        `await context.runInChildContext(async (ctx) => helper("x", ctx));`,
        "async function helper(this: void, a: string, c: any) { return c.step(async () => 1); }",
      ),
      handler(`
        await context.runInChildContext(async function (this: void, ctx: DurableContext) {
          return ctx.step(async () => 1);
        });
      `),
      // A parallel branch object whose effective func the rule cannot see:
      // a later spread or computed key can override it, and an accessor
      // returns a value the rule does not compute.
      handler(`
        await context.parallel([
          { func: async () => 0, ...durableBranch },
          { func: async () => 0, [key]: async (ctx) => ctx.step(async () => 1) },
          { get func() { return async (ctx) => ctx.step(async () => 1); } },
        ]);
      `),
      // A later func property overrides an earlier one.
      handler(`
        await context.parallel([
          { func: async () => 0, func: async (ctx) => ctx.step(async () => 1) },
        ]);
      `),
      // A function declaration that the file reassigns is not followed.
      handler(
        "await context.runInChildContext(async (ctx) => helper(ctx));",
        `async function helper(c) { return 1; }
        helper = async (c) => c.step(async () => 1);`,
      ),
    ],
    invalid: [
      // The examples from the issue.
      {
        code: handler(`
          await context.runInChildContext("transform", async (ctx) => cheapTransform(event));
        `),
        errors: [error("runInChildContext")],
      },
      {
        code: handler(`
          await context.map("transform", items, async (ctx, item) => cheapTransform(item), {
            nesting: NestingType.FLAT,
          });
        `),
        errors: [error("map")],
      },
      // No context parameter at all.
      {
        code: handler(`
          await context.runInChildContext(async () => compute());
          await context.runInChildContext("named", function () { return compute(); });
        `),
        errors: [error("runInChildContext"), error("runInChildContext")],
      },
      // Only non-durable members of the context are used.
      {
        code: handler(`
          await context.runInChildContext(async (ctx) => {
            ctx.logger.info("transforming");
            return cheapTransform(event);
          });
        `),
        errors: [error("runInChildContext")],
      },
      // The context is only used in a type position.
      {
        code: handler(`
          await context.runInChildContext(async (ctx) => {
            const copy: typeof ctx | undefined = undefined;
            return compute(copy);
          });
        `),
        errors: [error("runInChildContext")],
      },
      // A durable operation on the parent context does not count.
      {
        code: handler(`
          await context.runInChildContext(async (ctx) => context.step(async () => 1));
        `),
        errors: [error("runInChildContext")],
      },
      // map without a name, and parallel branches in both shapes.
      {
        code: handler(`
          await context.map(items, async (ctx, item) => compute(item));
          await context.parallel("branches", [
            async (ctx) => ctx.step(async () => 1),
            async (ctx) => compute(),
            { name: "b", func: async () => compute() },
            { "func": async (ctx) => compute() },
          ]);
        `),
        errors: [
          error("map"),
          error("parallel branch"),
          error("parallel branch"),
          error("parallel branch"),
        ],
      },
      // The helper the context reaches performs no durable operation.
      {
        code: handler(
          `
          await context.runInChildContext(async (ctx) => log(ctx));
          await context.runInChildContext(async (ctx) => ignore(ctx));
          await context.runInChildContext(async (ctx) => wrapper(ctx));
          `,
          `
          function log(c) { c.logger.info("x"); return compute(); }
          function ignore() { return compute(); }
          const wrapper = (c) => log(c);
          `,
        ),
        errors: [
          error("runInChildContext"),
          error("runInChildContext"),
          error("runInChildContext"),
        ],
      },
      // Helpers that call each other end without a durable operation.
      {
        code: handler(
          "await context.runInChildContext(async (ctx) => ping(ctx, 3));",
          `
          function ping(c, n) { return n > 0 ? pong(c, n - 1) : compute(); }
          function pong(c, n) { return ping(c, n); }
          `,
        ),
        errors: [error("runInChildContext")],
      },
      // A named function passed as the child-context function. The report
      // points at the argument.
      {
        code: handler(
          "await context.runInChildContext(transform);",
          "const transform = async (c) => compute();",
        ),
        errors: [{ ...error("runInChildContext"), line: 4 }],
      },
      // runInChildContext is checked on any receiver.
      {
        code: "anything.runInChildContext(async (ctx) => compute());",
        errors: [error("runInChildContext")],
      },
      // A context annotated as DurableContext, with or without a namespace.
      {
        code: `
          async function run(ctx: DurableContext, other: sdk.DurableContext<Logger>) {
            await ctx.map(items, async (c, item) => compute(item));
            await other.parallel([async (c) => compute()]);
          }
        `,
        errors: [error("map"), error("parallel branch")],
      },
      // The first parameter of a recognized child-context function is a context.
      {
        code: handler(`
          await context.runInChildContext(async (ctx) =>
            ctx.map(items, async (inner, item) => compute(item)),
          );
        `),
        errors: [error("map")],
      },
      // A nested child context is checked on its own.
      {
        code: handler(`
          await context.runInChildContext(async (ctx) => {
            await ctx.step(async () => 1);
            await ctx.runInChildContext(async (inner) => compute());
          });
        `),
        errors: [error("runInChildContext")],
      },
      // A rest parameter after the context's index does not collect it.
      {
        code: handler(
          "await context.runInChildContext(async (ctx) => helper(ctx, 1, 2));",
          "function helper(c, ...rest) { c.logger.info(rest); return 1; }",
        ),
        errors: [error("runInChildContext")],
      },
      // A default value on the context parameter is not a use of it.
      {
        code: handler(
          "await context.runInChildContext(async (ctx: any = null) => 1);",
        ),
        errors: [error("runInChildContext")],
      },
      // A handler passed to withDurableExecution by name.
      {
        code: `
          const workflow = async (event, ctx) =>
            ctx.map([1], async (child, item) => item);
          export const handler = withDurableExecution(workflow);
        `,
        errors: [error("map")],
      },
      // DurableContext imported under another name.
      {
        code: `
          import type { DurableContext as Ctx } from "@aws/durable-execution-sdk-js";
          async function run(ctx: Ctx) {
            await ctx.parallel([async (c) => compute()]);
          }
        `,
        errors: [error("parallel branch")],
      },
      // A child-context function passed by name gives its parameter the
      // context type, so its own map call is checked.
      {
        code: handler(
          "await context.runInChildContext(process);",
          `async function process(c) {
            await c.step(async () => 1);
            await c.map(items, async (inner, item) => compute(item));
          }`,
        ),
        errors: [error("map")],
      },
      // A spread before func does not override it.
      {
        code: handler(
          "await context.parallel([{ ...base, func: async () => compute() }]);",
        ),
        errors: [error("parallel branch")],
      },
      // A child context nested in a function passed by name is recognized
      // whether the function is declared before or after the handler.
      ...[
        [
          "async function outer(c) { return c.map([1], async (inner) => inner.map([1], async () => 1)); }",
          "withDurableExecution(async (_, ctx) => ctx.runInChildContext(outer));",
        ],
        [
          "withDurableExecution(async (_, ctx) => ctx.runInChildContext(outer));",
          "async function outer(c) { return c.map([1], async (inner) => inner.map([1], async () => 1)); }",
        ],
      ].map((lines) => ({
        code: lines.join("\n"),
        errors: [{ ...error("map"), column: 77 }],
      })),
      // A branch list wrapped in as const, and a branch in method syntax.
      {
        code: handler(`
          await context.parallel([
            { name: "a", async func(ctx) { return compute(); } },
            async (ctx) => compute(),
          ] as const);
        `),
        errors: [error("parallel branch"), error("parallel branch")],
      },
      // withDurableExecution called as a method, with a function expression.
      {
        code: `
          export const handler = sdk.withDurableExecution(async function (event, context) {
            await context.map(items, async (ctx, item) => compute(item));
          });
        `,
        errors: [error("map")],
      },
    ],
  },
);

describe("require-durable-operation-in-child-context", () => {
  it("is a suggestion that the recommended config leaves off", () => {
    const meta = requireDurableOperationInChildContext.meta!;
    expect(meta.type).toBe("suggestion");
    expect(meta.docs?.recommended).toBe(false);
  });
});
