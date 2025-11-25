import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Callback - Custom Serdes",
  description:
    "Demonstrates waitForCallback with custom serialization/deserialization",
};

export interface CustomData {
  id: number;
  message: string;
  timestamp: Date;
  metadata: {
    version: string;
    processed: boolean;
  };
  circular: CustomData | undefined;
}

const customSerdes = {
  deserialize: async (
    str: string | undefined,
  ): Promise<CustomData | undefined> => {
    if (str === undefined) return Promise.resolve(undefined);
    const parsed = JSON.parse(str) as {
      id: number;
      message: string;
      timestamp: string;
      metadata: {
        version: string;
        processed: boolean;
      };
    };
    const result: CustomData = {
      id: parsed.id,
      message: parsed.message,
      timestamp: new Date(parsed.timestamp),
      metadata: {
        ...parsed.metadata,
        // Set to true by serdes, but always false in the callback result
        processed: true,
      },
      circular: undefined,
    };

    // Deserializing into a circular reference should cause no issues
    result.circular = result;

    return result;
  },
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const result = await context.waitForCallback(
      "custom-serdes-callback",
      async () => {
        // Submitter succeeds
        return Promise.resolve();
      },
      {
        serdes: customSerdes,
        timeout: { minutes: 5 },
      },
    );

    const isSerdesProcessedBefore = await context.step(() =>
      Promise.resolve(result.metadata.processed),
    );

    const isDateBeforeReplay = await context.step(() =>
      Promise.resolve(result.timestamp instanceof Date),
    );

    await context.wait({ seconds: 1 });

    const hasCircularReference = result.circular === result;

    // Don't return the circular result to avoid result serialization issues
    delete result.circular;

    return {
      receivedData: result,
      hasCircularReference,
      isDateAfterReplay: result.timestamp instanceof Date,
      isDateBeforeReplay: isDateBeforeReplay,
      isSerdesProcessedBefore: isSerdesProcessedBefore,
      isSerdesProcessedAfter: result.metadata.processed,
    };
  },
);
