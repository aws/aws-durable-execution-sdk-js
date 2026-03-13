import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-virtual-context";

describe("Map Virtual Context", () => {
  let runner: LocalDurableTestRunner;

  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  beforeEach(() => {
    runner = new LocalDurableTestRunner({ handlerFunction: handler });
  });

  it("should process items with virtual context", async () => {
    const result = await runner.run({});

    expect(result.getStatus()).toBe("SUCCEEDED");

    const output = result.getResult();
    expect(output.processedItems).toEqual([2, 4, 6, 8, 10]);
    expect(output.totalCount).toBe(5);
    expect(output.successCount).toBe(5);

    // Verify map operation exists
    const mapOp = runner.getOperation("process-items-virtual");
    expect(mapOp.getStatus()).toBe("SUCCEEDED");
  });
});
