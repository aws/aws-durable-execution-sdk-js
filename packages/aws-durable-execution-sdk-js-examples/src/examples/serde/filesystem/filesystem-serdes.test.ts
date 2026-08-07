import { rm } from "node:fs/promises";
import {
  ExecutionStatus,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { basePath, handler } from "./filesystem-serdes";

/**
 * The checkpoint envelope written by the filesystem serdes. In ALWAYS mode the
 * value is offloaded to a file and the checkpoint keeps only the file pointer
 * plus an inline preview.
 */
interface FileSystemEnvelope {
  file: string;
  preview?: Record<string, unknown>;
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    // The example writes ~140KB into a temp directory on every run. Remove it
    // so runs do not accumulate on disk. Cleanup lives in the test, not the
    // handler, so the example stays a realistic production snippet.
    afterAll(async () => {
      await rm(basePath, { recursive: true, force: true });
    });

    it("should write the result to a file and read it back through the serdes", async () => {
      const execution = await runner.run({
        payload: { reportId: "RPT-001" },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // generate-report step + summarize-report step
      expect(execution.getOperations().length).toBe(2);

      const generateStep = runner.getOperation("generate-report");
      expect(generateStep.getType()).toBe(OperationType.STEP);
      expect(generateStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const summarizeStep = runner.getOperation("summarize-report");
      expect(summarizeStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // The rehydrated report round-tripped through the file store: the large
      // body length survives, proving deserialize read the file back.
      const result = execution.getResult() as any;
      expect(result.id).toBe("RPT-001");
      expect(result.status).toBe("generated");
      expect(result.bodyLength).toBe("REPORT-".repeat(20_000).length);

      // The checkpoint stores the file pointer + inline preview, never the
      // large body. getStepDetails().result exposes the raw envelope for a
      // step whose value was offloaded by the serdes.
      const envelope = generateStep.getStepDetails()
        ?.result as FileSystemEnvelope;
      expect(typeof envelope.file).toBe("string");
      expect(envelope.file.length).toBeGreaterThan(0);

      const preview = envelope.preview as Record<string, unknown>;
      // EXCLUDE_ALL + include id/status: both included fields are present.
      expect(preview.id).toBe("RPT-001");
      expect(preview.status).toBe("generated");
      // mask ownerEmail: present in the preview but redacted, never leaked.
      expect(preview).toHaveProperty("ownerEmail");
      expect(preview.ownerEmail).toBe("***");
      expect(preview.ownerEmail).not.toContain("owner@example.com");
      // The large body is not an included field, so EXCLUDE_ALL keeps it out.
      expect(preview).not.toHaveProperty("body");

      assertEventSignatures(execution);
    });
  },
});
