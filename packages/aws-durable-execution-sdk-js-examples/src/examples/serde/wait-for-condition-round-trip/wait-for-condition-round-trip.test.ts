import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./wait-for-condition-round-trip";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should round-trip state through the serdes on the first check and return the checkpointed state", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const pollOp = runner.getOperation("poll-until-ready");
      expect(pollOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const result = execution.getResult() as {
        finalState: {
          polls: number;
          roundTrippedOnEachCheck: boolean[];
          roundTripped?: boolean;
        };
        firstRunState: unknown;
        firstRunMatchesReplay: boolean;
      };

      // The first entry proves the first check received a round-tripped
      // initialState. The SDK previously passed the raw initialState, which
      // has no marker, so the first entry was false.
      expect(result.finalState.roundTrippedOnEachCheck).toEqual([
        true,
        true,
        true,
      ]);

      // waitStrategy set polls to -1. The returned value is the checkpointed
      // state, so the mutation is absent, and the marker proves the value
      // came from deserialize.
      expect(result.finalState.polls).toBe(3);
      expect(result.finalState.roundTripped).toBe(true);

      // firstRunState is the value waitForCondition returned on its first
      // run. finalState is the value it returned on replay after the wait.
      expect(result.firstRunState).toEqual(result.finalState);
      expect(result.firstRunMatchesReplay).toBe(true);

      assertEventSignatures(execution);
    });
  },
});
