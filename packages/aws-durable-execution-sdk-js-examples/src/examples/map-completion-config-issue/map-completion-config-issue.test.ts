import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-completion-config-issue";
import { createTests } from "../../utils/test-helper";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should reproduce the completion config behavior with detailed logging", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as {
        totalItems: number;
        successfulCount: number;
        failedCount: number;
        hasFailures: boolean;
        batchStatus: string;
        completionReason: string;
        successfulItems: Array<{
          index: number;
          itemId: number;
        }>;
        failedItems: Array<{
          index: number;
          itemId: number;
          error: string;
        }>;
      };

      // Verify the correct behavior after the fix
      expect(result).toMatchObject({
        totalItems: 4,
        successfulCount: 2,
        failedCount: 0, // Fixed: failures are now properly handled when minSuccessful is reached
        hasFailures: false,
        batchStatus: "SUCCEEDED",
        completionReason: "MIN_SUCCESSFUL_REACHED",
      });

      assertEventSignatures(execution);
    });
  },
});
