import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";
import { log } from "../../utils/logger";

export const config: ExampleConfig = {
  name: "Large Data Test",
  description:
    "Test that creates and returns large data in each step, followed by a wait.",
  durableConfig: {
    RetentionPeriodInDays: 7,
    ExecutionTimeout: 300, // 5 minutes to handle the large data processing
  },
};

function generateLargeString(): string {
  const chunkSize = 1000;
  const pattern = "A".repeat(chunkSize);
  const chunks = [];

  for (let i = 0; i < 150; i++) {
    chunks.push(`${pattern}${i.toString().padStart(4, "0")}`);
  }

  return chunks.join("");
}

export const handler = withDurableExecution(
  async (_event, context: DurableContext) => {
    for (let i = 1; i <= 100; i++) {
      await context.step(async () => {
        log(`Generating data in step ${i}`);
        const largeData = generateLargeString();
        return {
          largeData,
        };
      });
    }

    log("All steps completed. Starting wait period...");

    await context.wait({ seconds: 5 });

    log("Wait completed. Test finished.");

    return "";
  },
);
