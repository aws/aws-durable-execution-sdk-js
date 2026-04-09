import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./parallel-invoke";
import { handler as namedStepHandler } from "../../step/named/step-named";
import { handler as namedWaitHandler } from "../../wait/named/wait-named";

createTests({
  handler,
  tests: (runner, { functionNameMap, assertEventSignatures }) => {
    it("should complete all parallel invoke branches with staggered completions", async () => {
      const stepTarget = functionNameMap.getFunctionName("step-named");
      const waitTarget = functionNameMap.getFunctionName("wait-named");

      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(stepTarget, namedStepHandler);
        runner.registerDurableFunction(waitTarget, namedWaitHandler);
      }

      // Branch 0: instant (step-named)
      // Branch 1: 2s wait (wait-named)
      // Branch 2: 2s wait (wait-named)
      // This creates staggered completions — branch 0 finishes first,
      // then branches 1 and 2 finish after their wait expires.
      const execution = await runner.run({
        payload: {
          functionNames: [stepTarget, waitTarget, waitTarget],
        },
      });

      expect(execution.getResult()).toEqual({
        successCount: 3,
      });

      const parallelOp = runner.getOperation("parallel-invokes");
      expect(parallelOp.getChildOperations()).toHaveLength(3);

      // Staggered completions cause multiple suspend/resume cycles.
      // Allow a range since cloud timing is unpredictable.
      const invocations = execution.getInvocations();
      expect(invocations.length).toBeGreaterThanOrEqual(2);
      expect(invocations.length).toBeLessThanOrEqual(5);

      assertEventSignatures(execution);
    });
  },
});
