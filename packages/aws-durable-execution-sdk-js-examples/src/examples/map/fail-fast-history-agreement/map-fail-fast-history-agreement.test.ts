import { OperationType } from "@aws/durable-execution-sdk-js-testing";
import { handler, Scenario } from "./map-fail-fast-history-agreement";
import { createTests } from "../../../utils/test-helper";

interface Output {
  live: { statuses: string[]; results: number[] };
  replay: { statuses: string[]; results: number[] };
}

createTests<Output>({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it.each<[Scenario, string[], number[]]>([
      // The failure is recorded first and completes the batch. The successes
      // are recorded after the decision, so they stay STARTED everywhere.
      ["same-turn", ["STARTED", "FAILED", "STARTED", "STARTED"], []],
      // A slow deserializer does not change the outcome.
      [
        "slow-item-deserialize",
        ["STARTED", "FAILED", "STARTED", "STARTED"],
        [],
      ],
      // The successes are recorded before the failure, so they are kept.
      [
        "failure-later",
        ["SUCCEEDED", "FAILED", "SUCCEEDED", "SUCCEEDED"],
        [0, 20, 30],
      ],
    ])(
      "%s: the result, the history and the replay agree (issue #967)",
      async (scenario, statuses, results) => {
        const execution = await runner.run({ payload: { scenario } });
        expect(execution.getStatus()).toBe("SUCCEEDED");
        // The wait in the handler forces a replay.
        expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

        const output = execution.getResult() as Output;
        expect(output.live.statuses).toEqual(statuses);
        expect(output.live.results).toEqual(results);
        expect(output.replay).toEqual(output.live);

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
        expect(history).toEqual(statuses);

        assertEventSignatures(execution, scenario);
      },
    );
  },
});
