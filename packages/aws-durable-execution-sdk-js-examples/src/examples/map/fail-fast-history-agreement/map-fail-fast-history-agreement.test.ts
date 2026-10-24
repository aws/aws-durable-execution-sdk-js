import {
  LocalDurableTestRunner,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { handler, Scenario } from "./map-fail-fast-history-agreement";

interface Output {
  live: { statuses: string[]; results: number[] };
  replay: { statuses: string[]; results: number[] };
}

describe("map fail-fast: result and history agree (issue #967)", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  const run = async (
    scenario: Scenario,
  ): Promise<{ output: Output; history: string[] }> => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run({ payload: { scenario } });
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

    // The child context status of each map item, in index order.
    const history = [0, 1, 2, 3].map(
      (index) =>
        execution
          .getOperations()
          .find(
            (op) =>
              op.getType() === OperationType.CONTEXT &&
              op.getName() === `map-item-${index}`,
          )
          ?.getStatus() ?? "MISSING",
    );
    return { output: execution.getResult() as Output, history };
  };

  it.each<[Scenario, string[], number[]]>([
    // The failure is recorded first and completes the batch. The successes
    // are recorded after the decision, so they stay STARTED everywhere.
    ["same-turn", ["STARTED", "FAILED", "STARTED", "STARTED"], []],
    // A slow deserializer does not change the outcome.
    ["slow-item-deserialize", ["STARTED", "FAILED", "STARTED", "STARTED"], []],
    // The successes are recorded before the failure, so they are kept.
    [
      "failure-later",
      ["SUCCEEDED", "FAILED", "SUCCEEDED", "SUCCEEDED"],
      [0, 20, 30],
    ],
  ])("%s", async (scenario, statuses, results) => {
    const { output, history } = await run(scenario);

    expect(output.live.statuses).toEqual(statuses);
    expect(output.live.results).toEqual(results);
    expect(history).toEqual(statuses);
    expect(output.replay).toEqual(output.live);
  });
});
