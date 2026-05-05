import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-with-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: {
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should process all items when all callbacks succeed", async () => {
      const approvalAlpha = runner.getOperation("approval-order-alpha");
      const approvalBeta = runner.getOperation("approval-order-beta");
      const approvalGamma = runner.getOperation("approval-order-gamma");

      const executionPromise = runner.run();

      // All 3 items run concurrently (maxConcurrency: 3), so all callbacks
      // get submitted roughly at the same time. Wait for each and approve.
      await Promise.all([
        approvalAlpha.waitForData(WaitingOperationStatus.SUBMITTED),
        approvalBeta.waitForData(WaitingOperationStatus.SUBMITTED),
        approvalGamma.waitForData(WaitingOperationStatus.SUBMITTED),
      ]);

      await approvalAlpha.sendCallbackSuccess(JSON.stringify("approved"));
      await approvalBeta.sendCallbackSuccess(JSON.stringify("approved"));
      await approvalGamma.sendCallbackSuccess(JSON.stringify("approved"));

      const execution = await executionPromise;
      const result = execution.getResult() as any;

      expect(result.totalProcessed).toBe(3);
      expect(result.totalFailed).toBe(0);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.items).toHaveLength(3);

      // Verify each item was prepared, approved, and processed
      for (const item of result.items) {
        expect(item.status).toBe("completed");
        expect(item.approval).toBe(JSON.stringify("approved"));
        expect(item.preparedAt).toBe("2025-01-01T00:00:00Z");
      }

      // Verify the map has 3 child operations (one per item)
      const mapOp = runner.getOperation("approval-pipeline");
      expect(mapOp.getChildOperations()).toHaveLength(3);

      // Verify individual step operations exist
      expect(runner.getOperation("prepare-order-alpha")).toBeDefined();
      expect(runner.getOperation("process-order-alpha")).toBeDefined();
      expect(runner.getOperation("prepare-order-beta")).toBeDefined();
      expect(runner.getOperation("process-order-beta")).toBeDefined();
      expect(runner.getOperation("prepare-order-gamma")).toBeDefined();
      expect(runner.getOperation("process-order-gamma")).toBeDefined();

      assertEventSignatures(execution);
    }, 30000);

    it("should fail fast when a callback fails and no tolerance is set", async () => {
      const approvalAlpha = runner.getOperation("approval-order-alpha");

      const executionPromise = runner.run();

      // Fail the first callback
      await approvalAlpha.waitForData(WaitingOperationStatus.SUBMITTED);
      await approvalAlpha.sendCallbackFailure({
        ErrorMessage: "Rejected by reviewer",
      });

      const execution = await executionPromise;
      const result = execution.getResult() as any;

      // Default behavior: fail-fast, so at least 1 item fails
      expect(result.totalFailed).toBeGreaterThanOrEqual(1);
      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");

      assertEventSignatures(execution, "callback-failure");
    });

    it("should handle callback timeout within map iteration", async () => {
      // Run with a single item that has a short callback timeout (10s from handler)
      const execution = await runner.run({
        payload: {
          items: [{ id: 1, name: "timeout-item" }],
        },
      });

      const result = execution.getResult() as any;

      // The callback should time out, causing the map item to fail
      expect(result.totalFailed).toBe(1);
      expect(result.totalProcessed).toBe(0);
      expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");

      assertEventSignatures(execution, "callback-timeout");
    }, 30000);
  },
});
