import { RuleTester } from "eslint";
import { noClosureInDurableOperations } from "./no-closure-in-durable-operations";

const ruleTester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
} as any);

describe("no-closure-in-durable-operations integration tests", () => {
  ruleTester.run(
    "no-closure-in-durable-operations",
    noClosureInDurableOperations,
    {
      valid: [
        // Reading closure variables is allowed
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step(async () => {
                return counter + 1;
              });
            }
          `,
        },
        // Using local variables is allowed
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(async () => {
                let counter = 0;
                counter++;
                return counter;
              });
            }
          `,
        },
        // Reading in runInChildContext is allowed
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              const userId = event.userId;
              await context.runInChildContext(async (ctx) => {
                return await fetchUser(userId);
              });
            }
          `,
        },
        // Function parameters can be modified
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(async (ctx) => {
                ctx = null;
                return "done";
              });
            }
          `,
        },
        // Named step with reading
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let value = 10;
              await context.step("myStep", async () => {
                return value * 2;
              });
            }
          `,
        },
        // waitForCondition with reading
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let threshold = 100;
              await context.waitForCondition(async () => {
                return getCount() > threshold;
              });
            }
          `,
        },
      ],
      invalid: [
        // Direct assignment
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step(async () => {
                counter = 5;
                return counter;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "counter" },
            },
          ],
        },
        // Increment operator
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step(async () => {
                counter++;
                return counter;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "counter" },
            },
          ],
        },
        // Pre-increment
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step(async () => {
                ++counter;
                return counter;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "counter" },
            },
          ],
        },
        // Decrement
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 10;
              await context.step(async () => {
                counter--;
                return counter;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "counter" },
            },
          ],
        },
        // Compound assignment
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let total = 0;
              await context.step(async () => {
                total += 10;
                return total;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "total" },
            },
          ],
        },
        // Named step with mutation
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let value = 10;
              await context.step("myStep", async () => {
                value = 20;
                return value;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "value" },
            },
          ],
        },
        // runInChildContext with mutation
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let result = null;
              await context.runInChildContext(async (ctx) => {
                result = await fetchData();
                return result;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "result" },
            },
          ],
        },
        // waitForCondition with mutation
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let attempts = 0;
              await context.waitForCondition(async () => {
                attempts++;
                return attempts > 5;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "attempts" },
            },
          ],
        },
        // waitForCallback with mutation
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let callbackData = null;
              await context.waitForCallback(async (resolve) => {
                callbackData = "received";
                resolve();
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "callbackData" },
            },
          ],
        },
        // Nested step with mutation (reported in both contexts)
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.runInChildContext(async (ctx) => {
                await ctx.step(async () => {
                  counter++;
                  return counter;
                });
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "counter" },
            },
            {
              messageId: "closureVariableUsage",
              data: { variableName: "counter" },
            },
          ],
        },
        // Multiple mutations
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              let b = 0;
              await context.step(async () => {
                a++;
                b = 10;
                return a + b;
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "a" },
            },
            {
              messageId: "closureVariableUsage",
              data: { variableName: "b" },
            },
          ],
        },
        // Function parameter from outer scope
        {
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(async () => {
                event = null;
                return "done";
              });
            }
          `,
          errors: [
            {
              messageId: "closureVariableUsage",
              data: { variableName: "event" },
            },
          ],
        },
      ],
    },
  );
});
