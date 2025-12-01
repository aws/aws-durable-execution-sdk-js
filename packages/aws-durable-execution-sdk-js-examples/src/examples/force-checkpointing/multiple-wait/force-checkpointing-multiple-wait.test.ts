import { handler } from "./force-checkpointing-multiple-wait";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  name: "force-checkpointing-multiple-wait",
  functionName: "force-checkpointing-multiple-wait",
  handler,
  tests: (runner) => {
    it("should complete with force checkpointing when one branch blocks termination with multiple waits", async () => {
      const startTime = Date.now();

      const execution = await runner.run();

      const duration = Date.now() - startTime;

      // Verify the result
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      const result = JSON.parse(execution.getResult() as string);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.all).toHaveLength(2);
      expect(result.all[0].result).toBe("long-complete");
      expect(result.all[1].result).toBe("waits-complete");

      // Should complete in less than 15 seconds
      // (10s for long-running step + ~5s for waits)
      expect(duration).toBeLessThan(15000);

      // Should complete in a single invocation
      // The long-running step prevents termination, so the wait operations
      // use force checkpoint to get status updates without terminating
      const invocations = execution.getInvocations();
      expect(invocations).toHaveLength(1);

      // Verify operations were tracked
      const operations = execution.getOperations();
      expect(operations.length).toBeGreaterThan(0);
    }, 20000); // 20 second timeout
  },
});
