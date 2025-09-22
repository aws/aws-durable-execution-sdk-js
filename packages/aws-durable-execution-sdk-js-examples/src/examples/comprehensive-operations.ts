import {
  DurableContext,
  withDurableFunctions,
} from "aws-durable-execution-sdk-js";

interface ComprehensiveExampleInput {
  message?: string;
}

/**
 * Comprehensive example demonstrating all major durable operations:
 * - ctx.step: Simple step that returns a result
 * - ctx.wait: Wait for a specified duration
 * - ctx.map: Map operation with multiple iterations
 * - ctx.parallel: Parallel execution of multiple branches
 */
export const handler = withDurableFunctions(
  async (event: ComprehensiveExampleInput, context: DurableContext) => {
    console.log("Starting comprehensive operations example with event:", event);

    // Step 1: ctx.step - Simple step that returns a result
    const step1Result = await context.step("step1", async () => {
      console.log("Executing step1");
      return "Step 1 completed successfully";
    });

    // Step 2: ctx.wait - Wait for 5 seconds
    await context.wait(5000);

    // Step 3: ctx.map - Map with 5 iterations returning numbers 1 to 5
    const mapInput = [1, 2, 3, 4, 5];
    const mapResults = await context.map(
      "map-numbers",
      mapInput,
      async (ctx, item, index) => {
        
        // Each iteration returns the number (1 to 5)
        const result = await ctx.step(`map-step-${index}`, async () => {
          return item;
        });
        
        return result;
      }
    );

    // Step 4: ctx.parallel - 3 branches, each returning a fruit name
    const parallelResults = await context.parallel([
      // Branch 1: Returns "apple"
      async (ctx: DurableContext) => {
        const result = await ctx.step("fruit-step-1", async () => {
          return "apple";
        });
        return result;
      },

      // Branch 2: Returns "banana"
      async (ctx: DurableContext) => {
        const result = await ctx.step("fruit-step-2", async () => {
          return "banana";
        });
        return result;
      },

      // Branch 3: Returns "orange"
      async (ctx: DurableContext) => {
        const result = await ctx.step("fruit-step-3", async () => {
          return "orange";
        });
        return result;
      },
    ]);

    // Final result combining all operations
    const finalResult = {
      step1: step1Result,
      waitCompleted: true,
      mapResults: mapResults,
      parallelResults: parallelResults,
      summary: {
        totalOperations: 4,
        stepResult: step1Result,
        numbersProcessed: mapResults,
        fruitsSelected: parallelResults,
      },
    };

    return finalResult;
  }
);
