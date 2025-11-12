import { RuleTester } from "eslint";
import { noNonDeterministicOutsideStep } from "./no-non-deterministic-outside-step";

const ruleTester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
} as any);

describe("no-non-deterministic-outside-step integration tests", () => {
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
      ],
    },
  );
});
