import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./parallel-invoke";
import { handler as namedStepHandler } from "../../step/named/step-named";
import { handler as configurableWaitHandler } from "../../wait/configurable/wait-configurable";

createTests({
  handler,
  tests: (runner, { functionNameMap, assertEventSignatures }) => {
    it("should complete all parallel invoke branches with staggered completions", async () => {
      const stepTarget = functionNameMap.getFunctionName("step-named");
      const waitTarget = functionNameMap.getFunctionName("wait-configurable");

      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(stepTarget, namedStepHandler);
        runner.registerDurableFunction(waitTarget, configurableWaitHandler);
      }

      // Branch 0: instant (step-named)
      // Branch 1: 2s wait (wait-configurable)
      // Branch 2: 4s wait (wait-configurable)
      // Each branch completes at a distinct time, ensuring deterministic
      // suspend/resume cycles regardless of cloud timing jitter.
      const execution = await runner.run({
        payload: {
          branches: [
            { functionName: stepTarget },
            { functionName: waitTarget, payload: { waitSeconds: 2 } },
            { functionName: waitTarget, payload: { waitSeconds: 4 } },
          ],
        },
      });

      expect(execution.getResult()).toEqual({
        successCount: 3,
      });

      const parallelOp = runner.getOperation("parallel-invokes");
      expect(parallelOp.getChildOperations()).toHaveLength(3);

      assertEventSignatures(execution);
    });
  },
});
