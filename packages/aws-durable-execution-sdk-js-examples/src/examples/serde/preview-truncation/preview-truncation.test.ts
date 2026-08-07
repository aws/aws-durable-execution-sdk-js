import { rm } from "node:fs/promises";
import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { basePath, handler } from "./preview-truncation";

interface FileSystemEnvelope {
  file: string;
  preview?: Record<string, unknown>;
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    afterAll(async () => {
      await rm(basePath, { recursive: true, force: true });
    });

    it("should offload the record, generate a truncated preview, and round-trip through the serdes", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // build-record + read-record
      expect(execution.getOperations().length).toBe(2);

      const buildStep = runner.getOperation("build-record");
      expect(buildStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const result = execution.getResult() as any;
      expect(result.id).toBe("acct-123");
      expect(result.tier).toBe("gold");
      expect(result.notesLength).toBe(500);

      // Inspect the inline preview stored in the checkpoint envelope.
      const envelope = buildStep.getStepDetails()?.result as FileSystemEnvelope;
      expect(typeof envelope.file).toBe("string");
      expect(envelope.file.length).toBeGreaterThan(0);

      const preview = envelope.preview as Record<string, unknown>;
      // The excluded secret is never present, even under INCLUDE_ALL.
      expect(preview).not.toHaveProperty("internalSecret");
      const previewJson = JSON.stringify(preview);
      expect(previewJson).not.toContain("do-not-log-me");

      // Truncation actually happened: the early, small fields fit within the
      // 128-byte budget, but the large `notes` string and the `history` array
      // that follow it were dropped once the budget was exhausted.
      expect(preview.id).toBe("acct-123");
      expect(preview.region).toBe("us-west-2");
      expect(preview.tier).toBe("gold");
      expect(preview).not.toHaveProperty("notes");
      expect(preview).not.toHaveProperty("history");

      // The preview respects the configured byte budget (maxPreviewBytes: 128).
      expect(Buffer.byteLength(previewJson, "utf-8")).toBeLessThanOrEqual(128);

      assertEventSignatures(execution);
    });
  },
});
