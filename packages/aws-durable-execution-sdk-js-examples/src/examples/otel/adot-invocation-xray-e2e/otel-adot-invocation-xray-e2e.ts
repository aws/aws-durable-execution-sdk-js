import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { ExampleConfig } from "../../../types";
import { xrayE2eWorkflow } from "../shared/xray-e2e-workflow";

// The ADOT layer registers the global TracerProvider used by default.
const plugin = new InvocationOtelPlugin();

export const config: ExampleConfig = {
  name: "OTel ADOT Invocation XRay E2E",
  durableConfig: {
    ExecutionTimeout: 120,
    RetentionPeriodInDays: 7,
  },
  excludeRuntimes: ["24.x"],
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const { xRayHeader, step1, step2, childResult } =
      await xrayE2eWorkflow(context);

    return {
      xRayHeader,
      result: { step1, step2, childResult },
    };
  },
  { plugins: [plugin] },
);
