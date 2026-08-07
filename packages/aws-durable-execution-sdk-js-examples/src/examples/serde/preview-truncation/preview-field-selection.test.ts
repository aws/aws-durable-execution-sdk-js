import { rm } from "node:fs/promises";
import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { basePath, handler } from "./preview-field-selection";

/**
 * The checkpoint envelope written by the filesystem serdes when the value is
 * offloaded to a file: the checkpoint keeps only the pointer, plus an inline
 * preview when `generatePreview` is configured.
 */
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

    it("should offload the profile with a field-selected preview and round-trip through the serdes", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // build-profile + read-profile
      expect(execution.getOperations().length).toBe(2);

      const buildStep = runner.getOperation("build-profile");
      expect(buildStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const result = execution.getResult() as any;
      expect(result.id).toBe("cust-9");
      expect(result.email).toBe("decoy@example.com");
      expect(result.customerEmail).toBe("person@example.com");
      expect(result.auditLength).toBe(2000);

      // Inspect the inline preview stored in the checkpoint envelope.
      const envelope = buildStep.getStepDetails()?.result as FileSystemEnvelope;
      expect(typeof envelope.file).toBe("string");
      expect(envelope.file.length).toBeGreaterThan(0);

      const preview = envelope.preview as {
        id?: unknown;
        email?: unknown;
        customer?: { id?: unknown; email?: unknown; ssn?: unknown };
        status?: unknown;
        auditLog?: unknown;
      };

      // `id` uses ANYWHERE matching (the default), so it is included at BOTH the
      // top level and nested inside `customer` — proving name matching applies
      // at any depth.
      expect(preview.id).toBe("cust-9");
      expect(preview.customer?.id).toBe("cust-9");

      // `customer.email` uses PATH matching: the exact nested path is included,
      // and ONLY that path. The value carries a decoy `email` at the top level
      // with the same field name; it must not appear.
      //
      // The decoy guards against a PATH implementation loosened to compare only
      // the last segment, or to `endsWith` — either would pull it in. It does
      // NOT distinguish PATH from ANYWHERE: under ANYWHERE the selector is
      // tested against individual path segments (`path.split(".")`), so a dotted
      // name matches nothing at all. Dropping `match: PATH` therefore makes
      // `customer.email` disappear from the preview rather than making the decoy
      // appear -- which is what the assertion below catches.
      expect(preview.customer?.email).toBe("person@example.com");
      expect(preview.email).toBeUndefined();
      expect(JSON.stringify(preview)).not.toContain("decoy@example.com");

      // `ssn` is masked: shown but redacted, never leaking the real value.
      expect(preview.customer?.ssn).toBe("***");
      expect(JSON.stringify(preview)).not.toContain("123-45-6789");

      // EXCLUDE_ALL keeps everything else out: neither the un-included top-level
      // `status` nor the large `auditLog` appear in the preview.
      expect(preview).not.toHaveProperty("status");
      expect(preview).not.toHaveProperty("auditLog");

      assertEventSignatures(execution);
    });
  },
});
