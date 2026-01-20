import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Non-Durable",
  description: "A simple non-durable function used for testing.",
  durableConfig: null,
};

export const handler = async (event: { failure: boolean; waitMs: number }) => {
  if (event.failure) {
    throw new Error("This is a failure");
  }

  if (event.waitMs !== 0) {
    await new Promise((resolve) => setTimeout(resolve, event.waitMs ?? 1000));
  }

  return {
    status: 200,
    body: JSON.stringify({ message: "Hello from Lambda!" }),
  };
};
