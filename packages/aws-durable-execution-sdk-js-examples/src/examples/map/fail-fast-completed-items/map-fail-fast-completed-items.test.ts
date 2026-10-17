import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-fail-fast-completed-items";

describe("map fail-fast completed items (issue #967)", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it("keeps finished items and their results when one map item fails", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    const output = execution.getResult() as {
      live: {
        statuses: string[];
        successCount: number;
        startedCount: number;
        results: number[];
      };
      replay: {
        statuses: string[];
        successCount: number;
        startedCount: number;
        results: number[];
      };
    };

    expect(output.live.statuses).toEqual([
      "SUCCEEDED",
      "FAILED",
      "SUCCEEDED",
      "SUCCEEDED",
    ]);
    expect(output.live.successCount).toBe(3);
    expect(output.live.results).toEqual([0, 20, 30]);
    expect(output.live.results).not.toHaveLength(0);

    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(output.replay.statuses).toEqual(output.live.statuses);
    expect(output.replay.successCount).toBe(3);
    expect(output.replay.results).toEqual([0, 20, 30]);
  });

  it("does not hang when two fail-fast maps run concurrently", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run({
      payload: { concurrentMaps: true },
    });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    const output = execution.getResult() as {
      left: { statuses: string[]; successCount: number; results: number[] };
      right: { statuses: string[]; successCount: number; results: number[] };
    };
    expect(output.left.statuses).toEqual([
      "SUCCEEDED",
      "FAILED",
      "SUCCEEDED",
      "SUCCEEDED",
    ]);
    expect(output.right.statuses).toEqual([
      "SUCCEEDED",
      "FAILED",
      "SUCCEEDED",
      "SUCCEEDED",
    ]);
    expect(output.left.successCount).toBe(3);
    expect(output.right.successCount).toBe(3);
    expect(output.left.results).toEqual([0, 20, 30]);
    expect(output.right.results).toEqual([0, 20, 30]);
  }, 10000);
});
