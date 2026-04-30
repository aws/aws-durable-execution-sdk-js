import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Configure Default Callback Deserializer",
  description:
    "Demonstrates configureSerdes({ defaultCallbackDeserializer }) with waitForCallback. " +
    "Verifies the callback result is deserialized exactly once — not double-deserialized.",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    // Configure a JSON-parsing deserializer for all callbacks.
    // Without the fix for double-deserialization, this would parse the result twice:
    // first inside createCallback, then again in waitForCallback phase 2 —
    // turning '{"value":42}' into 42 on first parse, then crashing on second parse.
    context.configureSerdes({
      defaultCallbackDeserializer: {
        deserialize: async (data: string | undefined) =>
          data !== undefined ? JSON.parse(data) : undefined,
      },
    });

    const result = await context.waitForCallback("approval", async () =>
      Promise.resolve(),
    );

    return { received: result };
  },
);
