import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Create Callback - Custom Serdes",
  description:
    "Demonstrates createCallback with custom serialization/deserialization for Date objects",
};

interface CustomData {
  id: number;
  message: string;
  timestamp: Date;
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
    };
    return Promise.resolve({
      ...parsed,
      timestamp: new Date(parsed.timestamp),
    });
  },
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<CustomData>(
      "custom-serdes-callback",
      {
        timeout: { minutes: 5 },
        serdes: customSerdes,
      },
    );

    const result = await callbackPromise;
    return {
      receivedData: result,
      isDateObject: result.timestamp instanceof Date,
    };
  },
);
