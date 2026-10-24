import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-concurrency-slot-held-until-settled";

describe("map maxConcurrency holds a slot until the item settles", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it("never runs two items at once with maxConcurrency 1", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run();

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      results: [0, 10, 20],
      // An item records its outcome before it deserializes its result. If
      // the slot were freed at that point, the next item would start while
      // the previous one still deserialized, and this would be 2.
      maxRunning: 1,
    });
  });
});
