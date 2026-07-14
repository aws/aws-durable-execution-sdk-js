import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { ExampleConfig } from "../../../types";

// No createOtelTestSetup — ADOT handles export at runtime
const plugin = new InvocationOtelPlugin();

export const config: ExampleConfig = {
  name: "OTel XRay E2E",
  durableConfig: {
    ExecutionTimeout: 120,
    RetentionPeriodInDays: 7,
  },
  excludeRuntimes: ["24.x"],
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Derive trace ID from X-Ray header for test assertions
    const xRayHeader = process.env._X_AMZN_TRACE_ID;

    // Exercise multiple operation types for X-Ray verification
    const step1 = await context.step("fetch-data", async () => "data-value");

    const step2 = await context.step(
      "process-data",
      async () => `processed-${step1}`,
    );

    const childResult = await context.runInChildContext(
      "child-operations",
      async (childCtx: DurableContext) => {
        const inner = await childCtx.step(
          "inner-step",
          async () => "inner-value",
        );
        return inner;
      },
    );

    return {
      xRayHeader,
      result: { step1, step2, childResult },
    };
  },
  { plugins: [plugin] },
);
