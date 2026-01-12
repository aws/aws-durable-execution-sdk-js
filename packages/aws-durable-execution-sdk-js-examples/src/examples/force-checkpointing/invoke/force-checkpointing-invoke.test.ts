import { handler } from "./force-checkpointing-invoke";
import { createTests } from "../../../utils/test-helper";
import {
  ExecutionStatus,
  LocalDurableTestRunner,
} from "@aws/durable-execution-sdk-js-testing";
import { handler as waitHandler } from "../../wait/basic/wait";
import { handler as stepHandler } from "../../step/basic/step-basic";

createTests({
  handler,
  tests: (runner, { functionNameMap, assertEventSignatures }) => {
    it("should complete with force checkpointing when one branch blocks termination with multiple invokes", async () => {
      // Register the invoked functions for local testing
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("wait"),
          waitHandler,
        );
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("step-basic"),
          stepHandler,
        );
      }

      const startTime = Date.now();

      const execution = await runner.run({
        payload: {
          functionNames: [
            functionNameMap.getFunctionName("wait"),
            functionNameMap.getFunctionName("step-basic"),
            functionNameMap.getFunctionName("wait"),
          ],
        },
      });

      const duration = Date.now() - startTime;

      // Verify the result
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      const result = JSON.parse(execution.getResult() as string);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.all).toHaveLength(2);
      expect(result.all[0].result).toBe("long-complete");
      expect(result.all[1].result).toBe("invokes-complete");

      // Should complete in less than 25 seconds
      // (20s for long-running step + time for invokes)
      expect(duration).toBeLessThan(25000);

      // Should complete in a single invocation
      // The long-running step prevents termination, so the invoke operations
      // use force checkpoint to get status updates without terminating
      const invocations = execution.getInvocations();
      expect(invocations).toHaveLength(1);

      // Verify operations were tracked
      const operations = execution.getOperations();
      expect(operations.length).toBeGreaterThan(0);

      assertEventSignatures(execution);
    }, 60000); // 60 second timeout
  },
});
