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

interface CustomData {
  id: number;
  message: string;
  timestamp: Date;
  metadata: {
    version: string;
    processed: boolean;
  };
}

const customSerdes = {
  serialize: async (
    data: CustomData | undefined,
  ): Promise<string | undefined> => {
    if (data === undefined) return Promise.resolve(undefined);
    return Promise.resolve(
      JSON.stringify({
        ...data,
        timestamp: data.timestamp.toISOString(),
        _serializedBy: "custom-serdes-v1",
      }),
    );
  },
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
      _serializedBy: string;
    };
    return Promise.resolve({
      id: parsed.id,
      message: parsed.message,
      timestamp: new Date(parsed.timestamp),
      metadata: parsed.metadata,
    });
  },
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const result = await context.waitForCallback<CustomData>(
      "custom-serdes-callback",
      async () => {
        // Submitter succeeds
        return Promise.resolve();
      },
      {
        serdes: customSerdes,
        timeout: 300,
      },
    );

    return {
      receivedData: result,
      isDateObject: result.timestamp instanceof Date,
    };
  },
);
