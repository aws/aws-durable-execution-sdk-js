import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "../promise-allsettled-unhandled-rejection";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("promise-allsettled-unhandled-rejection", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
    skipTime: true,
  });

  it("should handle failed step in allSettled during replay without unhandled rejection", async () => {
    try {
      const execution = await durableTestRunner.run();
      const result = execution.getResult() as any;

      expect(result?.successStep).toBe("Success");
    } catch (error) {
      // If we get here, it means the unhandled rejection bug still exists
      console.error("Caught unhandled rejection:", error);
      throw error;
    }
  });
});
