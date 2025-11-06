import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-completion-config-issue";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "map-completion-config-issue test",
  functionName: "map-completion-config-issue",
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner) => {
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

      // Print actual results for debugging
      console.log("=== ACTUAL RESULTS ===");
      console.log("Total items processed:", result.totalItems);
      console.log("Successful count:", result.successfulCount);
      console.log("Failed count:", result.failedCount);
      console.log("Has failures:", result.hasFailures);
      console.log("Batch status:", result.batchStatus);
      console.log("Completion reason:", result.completionReason);
      console.log(
        "Successful items:",
        JSON.stringify(result.successfulItems, null, 2),
      );
      console.log("Failed items:", JSON.stringify(result.failedItems, null, 2));

      // Verify the correct behavior after the fix
      expect(result).toMatchObject({
        totalItems: 4,
        successfulCount: 2,
        failedCount: 0, // Fixed: failures are now properly handled when minSuccessful is reached
        hasFailures: false,
        batchStatus: "SUCCEEDED",
        completionReason: "MIN_SUCCESSFUL_REACHED",
      });

      // Print execution details for debugging
      console.log("=== EXECUTION DETAILS ===");
      const operations = execution.getOperations();
      console.log("Total operations:", operations.length);

      const mapOp = runner.getOperation("completion-config-items");
      console.log(
        "Map operation child count:",
        mapOp.getChildOperations()?.length || 0,
      );

      // List all operations that were created
      console.log("=== ALL OPERATIONS ===");
      operations.forEach((op: any, index: number) => {
        console.log(`${index}: ${op.getName()} - ${op.getType()}`);
      });
    });
  },
});
