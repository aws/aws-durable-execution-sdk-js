import type { Event } from "@aws-sdk/client-lambda";
import { handler } from "./large-result-checkpointing";
import { createTests } from "../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

// 6MB Lambda response limit (minus a small envelope) enforced by the SDK.
const LAMBDA_RESPONSE_SIZE_LIMIT = 6 * 1024 * 1024 - 50;

/**
 * Asserts the SDK actually took the oversized-result path: rather than
 * returning the value inline, it wrote a separate EXECUTION-scoped SUCCEED
 * checkpoint (`execution-result-*`) carrying the full serialized result.
 *
 * That checkpoint surfaces as a second `ExecutionSucceeded` event whose `Id` is
 * the checkpoint's own id rather than the execution's, so the two are easy to
 * tell apart. On the ordinary inline path only the execution's own
 * `ExecutionSucceeded` exists.
 *
 * This is the authoritative signal. Measuring `execution.getResult()` is NOT:
 * the local runner hands back the full result either way, so a size assertion
 * on the returned value passes even when the oversize branch never runs.
 */
function expectOversizedResultCheckpoint(events: Event[]) {
  const executionId = events.find(
    (event) => event.EventType === "ExecutionStarted",
  )?.Id;
  expect(typeof executionId).toBe("string");

  const checkpointEvents = events.filter(
    (event) =>
      event.EventType === "ExecutionSucceeded" && event.Id !== executionId,
  );
  expect(checkpointEvents).toHaveLength(1);

  // The checkpoint carries the whole oversized payload, which is what made it
  // impossible to return inline in the first place.
  const payload =
    checkpointEvents[0].ExecutionSucceededDetails?.Result?.Payload;
  expect(typeof payload).toBe("string");
  expect(Buffer.byteLength(payload as string, "utf8")).toBeGreaterThan(
    LAMBDA_RESPONSE_SIZE_LIMIT,
  );
}

// NOTE ON THE HISTORY SNAPSHOTS (both modes):
// The `.history.json` files for this example contain `ExecutionStarted` TWICE
// (byte-identical: same EventId, Id, and timestamp) and `ExecutionSucceeded`
// twice. This is specific to the oversized-result path and is expected here —
// do not "fix" the snapshots.
//   * The duplicate `ExecutionStarted` is a known artifact of the LOCAL test
//     runner's history assembly, NOT a real SDK/production event. The SDK's
//     oversize branch writes a second EXECUTION-typed checkpoint
//     (`execution-result-*`, Action SUCCEED) with a different Id; that clobbers
//     the single-slot execution-operation tracker in the testing package's
//     IndexedOperations, so when the real execution operation is finally
//     re-emitted its already-recorded `ExecutionStarted` is appended a second
//     time. It would NOT appear against real Lambda (CloudDurableTestRunner
//     reads the service's authoritative event log). See the stage report.
//   * The EXTRA `ExecutionSucceeded` IS legitimate: one is the
//     `execution-result-*` result checkpoint the SDK writes, the other is the
//     execution's own completion. This second SUCCEED is exactly what makes the
//     oversize path assertable via signature counts, so it must be kept.
// `assertEventSignatures` only compares {EventType, SubType, Name} counts, so
// regenerating the snapshot reproduces these counts deterministically.

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("checkpoints an oversized aggregated array result and returns it in full", async () => {
      const execution = await runner.run({ payload: { mode: "records" } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        mode: string;
        totalRecords: number;
        totalBatches: number;
        records: { id: string; batch: number; data: string }[];
      };

      // The full result is recovered from the checkpoint even though it was too
      // large to be returned inline by Lambda.
      expect(result.mode).toBe("records");
      expect(result.totalBatches).toBe(6);
      expect(result.totalRecords).toBe(6000);
      expect(result.records).toHaveLength(6000);
      expect(result.records[0].id).toBe("rec-0-0");
      expect(result.records[result.records.length - 1].id).toBe("rec-5-999");

      // Prove the oversize path ran, rather than inferring it from the size of
      // the returned value.
      expectOversizedResultCheckpoint(execution.getHistoryEvents());

      // The single durable step still completed successfully.
      const step = runner.getOperation("load-batch-metadata");
      expect(step.getStepDetails()?.result).toEqual({
        batches: 6,
        recordsPerBatch: 1000,
      });

      assertEventSignatures(execution, "records");
    }, 120000);

    it("checkpoints an oversized document result and returns it in full", async () => {
      const execution = await runner.run({ payload: { mode: "document" } });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        mode: string;
        format: string;
        rowCount: number;
        byteLength: number;
        document: string;
      };

      // The full document is recovered from the checkpointed execution result
      // even though it exceeded Lambda's inline response limit.
      expect(result.mode).toBe("document");
      expect(result.format).toBe("csv");
      expect(result.rowCount).toBe(60000);
      expect(result.document.startsWith("0,user_0,")).toBe(true);
      expect(result.document.split("\n")).toHaveLength(60000);
      expect(result.byteLength).toBe(
        Buffer.byteLength(result.document, "utf8"),
      );

      // Prove the oversize path ran, rather than inferring it from the size of
      // the returned value.
      expectOversizedResultCheckpoint(execution.getHistoryEvents());

      // The durable step that produced the export spec completed successfully.
      const step = runner.getOperation("prepare-export");
      expect(step.getStepDetails()?.result).toEqual({
        format: "csv",
        rows: 60000,
      });

      assertEventSignatures(execution, "document");
    }, 120000);
  },
});
