import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Large Payload",
  description:
    "Demonstrates handling of large payloads (>6MB) in durable functions",
};

interface LargePayloadEvent {
  data: string;
  metadata?: {
    size: number;
    description: string;
  };
}

export const handler = withDurableExecution(
  async (event: LargePayloadEvent, context: DurableContext) => {
    const result = await context.step("process-large-payload", async () => {
      return {
        originalSize: event.data.length,
        first100Chars: event.data.substring(0, 100),
        hasMetadata: !!event.metadata,
        processedAt: new Date().toISOString(),
      };
    });

    return {
      success: true,
      payload: result,
    };
  },
);
