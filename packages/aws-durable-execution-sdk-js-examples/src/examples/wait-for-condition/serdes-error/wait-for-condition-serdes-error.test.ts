import { handler } from "./wait-for-condition-serdes-error";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

describe("wait-for-condition-serdes-error", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  it("should terminate execution due to serdes error", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    let error: any;
    try {
      await runner.run();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.name).toBe("SerdesFailedError");
    expect(error.message).toContain("simulated deserialization failure");
  });
});
