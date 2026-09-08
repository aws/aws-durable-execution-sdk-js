import { RuleTester } from "eslint";
import { noNonDeterministicOutsideStep } from "./no-non-deterministic-outside-step";

const ruleTester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
} as any);

describe("no-non-deterministic-outside-step composed tests", () => {
  ruleTester.run(
    "no-non-deterministic-outside-step",
    noNonDeterministicOutsideStep,
    {
      valid: [
        // Non-deterministic operations inside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const result = await context.step(async () => {
                return Math.random();
              });
            }
          `,
        },
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const result = await context.step(async () => {
                return Date.now();
              });
            }
          `,
        },
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const result = await context.step(async () => {
                return new Date();
              });
            }
          `,
        },
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const result = await context.step(async () => {
                return performance.now();
              });
            }
          `,
        },
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const result = await context.step(async () => {
                return crypto.randomBytes(16);
              });
            }
          `,
        },
        // Deterministic operations outside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const value = 42;
              const result = await context.step(async () => {
                return value * 2;
              });
            }
          `,
        },
        // Using Date with specific timestamp
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const specificDate = new Date("2024-01-01");
              await context.step(async () => "done");
            }
          `,
        },
        {
          name: "does not report same-named deterministic functions",
          code: `
            function a() { function h() { return 1; } return h(); }
            function b() { function h() { return 2; } return h(); }
          `,
        },
        {
          name: "ignores calls to functions it cannot resolve",
          code: `
            async function handler(event: any, context: DurableContext) {
              return externalHelper();
            }
          `,
        },
      ],
      invalid: [
        // Math.random() outside step (reports both call and member expression)
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const random = Math.random();
              await context.step(async () => random);
            }
          `,
          errors: 2, // CallExpression + MemberExpression
        },
        // Date.now() outside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const timestamp = Date.now();
              await context.step(async () => timestamp);
            }
          `,
          errors: 2, // CallExpression + MemberExpression
        },
        // new Date() without arguments outside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const now = new Date();
              await context.step(async () => now);
            }
          `,
          errors: [
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "new Date()" },
            },
          ],
        },
        // performance.now() outside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const time = performance.now();
              await context.step(async () => time);
            }
          `,
          errors: 2, // CallExpression + MemberExpression
        },
        // crypto.randomBytes() outside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const bytes = crypto.randomBytes(16);
              await context.step(async () => bytes);
            }
          `,
          errors: [
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "crypto.randomBytes()" },
            },
          ],
        },
        // crypto.getRandomValues() outside step
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const array = new Uint32Array(10);
              crypto.getRandomValues(array);
              await context.step(async () => array);
            }
          `,
          errors: [
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "crypto.getRandomValues()" },
            },
          ],
        },
        // Multiple non-deterministic operations
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const random = Math.random();
              const timestamp = Date.now();
              await context.step(async () => random + timestamp);
            }
          `,
          errors: 4, // 2 for Math.random + 2 for Date.now
        },
        // Non-deterministic in runInChildContext (outside step)
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.runInChildContext(async (ctx) => {
                const random = Math.random();
                await ctx.step(async () => random);
              });
            }
          `,
          errors: 2, // CallExpression + MemberExpression
        },
        // Non-deterministic in parallel branch (outside step)
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.parallel([
                async (ctx) => {
                  const random = Math.random();
                  return ctx.step(async () => random);
                },
              ]);
            }
          `,
          errors: 2, // CallExpression + MemberExpression
        },
        // Callees are resolved through scope analysis, so a non-deterministic
        // function does not taint an unrelated function of the same name.
        {
          name: "does not taint a same-named function in another scope",
          code: `
            function moduleA() { function h() { Date.now(); } h(); }
            function moduleB() { function h() { return 1; } return h(); }
          `,
          errors: [
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "Date.now()" },
            },
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "Date.now" },
            },
            {
              messageId: "nonDeterministicFunction",
              data: { functionName: "h" },
            },
          ],
        },
        // Callee resolution happens after the traversal, so declaration order
        // does not matter.
        {
          name: "reports calls to functions declared after the call site",
          code: `
            function outer() { return inner(); }
            function inner() { return Date.now(); }
            outer();
          `,
          errors: [
            {
              messageId: "nonDeterministicFunction",
              data: { functionName: "inner" },
            },
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "Date.now()" },
            },
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "Date.now" },
            },
            {
              messageId: "nonDeterministicFunction",
              data: { functionName: "outer" },
            },
          ],
        },
        // Arrow functions assigned to a variable resolve the same way.
        {
          name: "resolves arrow functions bound to variables",
          code: `
            const getTime = () => Date.now();
            async function handler(event: any, context: DurableContext) {
              return getTime();
            }
          `,
          errors: [
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "Date.now()" },
            },
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "Date.now" },
            },
            {
              messageId: "nonDeterministicFunction",
              data: { functionName: "getTime" },
            },
          ],
        },
        {
          name: "reports namespaced UUID generation outside a step",
          code: `
            async function handler(event: any, context: DurableContext) {
              const id = uuid.v4();
              await context.step(async () => id);
            }
          `,
          errors: [
            {
              messageId: "nonDeterministicOutsideStep",
              data: { operation: "UUID generation" },
            },
          ],
        },
      ],
    },
  );
});
