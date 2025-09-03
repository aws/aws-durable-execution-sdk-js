import { LambdaClient } from "@amzn/dex-internal-sdk";

let client: LambdaClient | undefined = undefined;
/**
 * Gets an instance of the durable executions client.
 */
export function getDurableExecutionsClient() {
  client ??= new LambdaClient({
    credentials: {
      secretAccessKey: "mock-secretAccessKey",
      accessKeyId: "mock-accessKeyId",
    },
    region: "us-east-1",
    endpoint: process.env.DEX_ENDPOINT,
  });

  return client;
}

/**
 * Resets the durable executions client singleton. Used primarily for testing
 */
export function resetDurableExecutionsClient() {
  client = undefined;
}
