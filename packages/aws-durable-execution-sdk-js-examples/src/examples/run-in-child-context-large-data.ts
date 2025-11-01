import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../types";

export const config: ExampleConfig = {
  name: "Run In Child Context Large Data",
  description:
    "Test runInChildContext with large data exceeding individual step limits",
};

/**
 * Generate a string of approximately the specified size in KB
 */
function generateLargeString(sizeInKB: number): string {
  const targetSize = sizeInKB * 1024; // Convert KB to bytes
  const baseString = "A".repeat(1000); // 1KB string
  const repetitions = Math.floor(targetSize / 1000);
  const remainder = targetSize % 1000;

  return baseString.repeat(repetitions) + "A".repeat(remainder);
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Use runInChildContext to handle large data that would exceed 256k step limit
    const largeDataResult = await context.runInChildContext(
      "large-data-processor",
      async (childContext: DurableContext) => {
        // Generate data using a loop - each step returns ~80KB of data (under the step limit)
        const stepResults: string[] = [];
        const stepSizes: number[] = [];

        for (let i = 1; i <= 5; i++) {
          const stepResult = await childContext.step(
            `generate-data-${i}`,
            async () => {
              const data = generateLargeString(50); // 50KB
              return data;
            },
          );

          stepResults.push(stepResult);
          stepSizes.push(stepResult.length);
        }

        // Concatenate all results - total should be ~250KB
        const concatenatedResult = stepResults.join("");

        return {
          totalSize: concatenatedResult.length,
          sizeInKB: Math.round(concatenatedResult.length / 1024),
          data: concatenatedResult,
          stepSizes: stepSizes,
        };
      },
    );

    // Add a wait after runInChildContext to test persistence across invocations
    await context.wait("post-processing-wait", 1);

    // Verify the data is still intact after the wait
    const dataIntegrityCheck =
      largeDataResult.data.length === largeDataResult.totalSize &&
      largeDataResult.data.length > 0;

    return {
      success: true,
      message:
        "Successfully processed large data exceeding individual step limits using runInChildContext",
      dataIntegrityCheck,
      summary: {
        totalDataSize: largeDataResult.sizeInKB,
        stepsExecuted: 5,
        childContextUsed: true,
        waitExecuted: true,
        dataPreservedAcrossWait: dataIntegrityCheck,
      },
    };
  },
);
