import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./parallel-virtual-context";

describe("Parallel Virtual Context", () => {
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

  it("should execute parallel tasks with virtual context", async () => {
    const result = await runner.run({});

    expect(result.getStatus()).toBe("SUCCEEDED");

    const output = result.getResult();
    expect(output.results).toEqual([
      { data: "fetched" },
      { processed: true },
      { valid: true },
    ]);
    expect(output.totalCount).toBe(3);
    expect(output.successCount).toBe(3);

    // Verify parallel operation exists
    const parallelOp = runner.getOperation("parallel-tasks-virtual");
    expect(parallelOp.getStatus()).toBe("SUCCEEDED");
  });
});
