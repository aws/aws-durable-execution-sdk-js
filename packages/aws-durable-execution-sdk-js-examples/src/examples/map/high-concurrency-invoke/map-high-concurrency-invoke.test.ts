import {
  ExecutionStatus,
  LocalDurableTestRunner,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-high-concurrency-invoke";
import { handler as nonDurable } from "../../non-durable/non-durable";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  localRunnerConfig: {
    checkpointDelay: 100, // 100ms delay to test checkpoint processing timing
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures, functionNameMap }) => {
    it("should execute successfully with high concurrency map and invoke operations", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerFunction(
          functionNameMap.getFunctionName("non-durable"),
          nonDurable,
        );
      }

      const execution = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("non-durable"),
        },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      // Verify map operation structure
      const mapOperation = runner.getOperation("process-objects");
      const childOperations = mapOperation.getChildOperations() ?? [];
      if (childOperations.length !== 200) {
        // Diagnostic for a rare cloud failure that saw 100 of 200 children.
        // Gaps in the history event IDs mean the history API returned an
        // incomplete history. No gaps point at the SDK checkpointing fewer
        // child contexts.
        const eventIds = new Set(
          execution.getHistoryEvents().map((event) => event.EventId),
        );
        const maxEventId = Math.max(
          0,
          ...[...eventIds].filter((id): id is number => id !== undefined),
        );
        const diagnostics = {
          childCount: childOperations.length,
          eventCount: eventIds.size,
          maxEventId,
          missingEventIds: Array.from({ length: maxEventId }, (_, i) => i + 1)
            .filter((id) => !eventIds.has(id))
            .slice(0, 50),
        };
        throw new Error(
          `Expected 200 map children: ${JSON.stringify(diagnostics)}`,
        );
      }
      expect(childOperations).toHaveLength(200);

      // Verify each child operation has the expected invoke operation
      const childOps = mapOperation.getChildOperations();
      expect(childOps).toBeDefined();

      childOps!.forEach((childOp) => {
        const childInvokeOps = childOp.getChildOperations();
        expect(childInvokeOps).toHaveLength(1);
        expect(childInvokeOps![0].getStatus()).toBe(OperationStatus.SUCCEEDED);
      });

      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 2,
      });
    });
  },
});
