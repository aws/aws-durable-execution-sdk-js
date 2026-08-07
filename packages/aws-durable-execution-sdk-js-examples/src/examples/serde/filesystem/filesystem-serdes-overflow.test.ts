import { rm } from "node:fs/promises";
import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { basePath, handler } from "./filesystem-serdes-overflow";
import { FileSystemEnvelope } from "../../shared/filesystem-envelope";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    // The large-document step overflows ~300KB to a temp file each run; remove
    // the base directory afterwards so runs do not accumulate on disk.
    afterAll(async () => {
      await rm(basePath, { recursive: true, force: true });
    });

    it("should keep small values inline, overflow large values to a file, and pass through undefined", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // small + large + empty + combine
      expect(execution.getOperations().length).toBe(4);

      expect(runner.getOperation("small-record").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("large-document").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("empty-record").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      // The distinction that defines OVERFLOW mode, and the only thing that
      // separates it from ALWAYS (spill everything) or from no serdes at all
      // (spill nothing): each envelope below must carry exactly one of `data`
      // or `file`, chosen by the value's size.
      const envelopeFor = (name: string) =>
        runner.getOperation(name).getStepDetails()?.result as
          | FileSystemEnvelope
          | undefined;

      // Small value: checkpointed inline as JSON, no file written.
      const smallEnvelope = envelopeFor("small-record");
      expect(smallEnvelope?.file).toBeUndefined();
      expect(JSON.parse(smallEnvelope!.data!)).toEqual({
        orderId: "ORD-42",
        total: 19.99,
      });

      // Large value (>256KB): would not fit in the checkpoint, so it overflows
      // to a file and only the pointer is stored.
      const largeEnvelope = envelopeFor("large-document");
      expect(largeEnvelope?.data).toBeUndefined();
      expect(typeof largeEnvelope?.file).toBe("string");
      // Assert the directory name, not the absolute path. `basePath` here is
      // computed in the test process; in cloud mode the handler runs on Lambda,
      // where `tmpdir()` is /tmp while a macOS test runner would produce
      // /var/folders/..., so comparing the two would couple the assertion to the
      // host.
      expect(largeEnvelope!.file).toContain("dur-example-fs-serdes-overflow");

      // Undefined result: passed straight through, so there is no envelope at
      // all and nothing was written to the filesystem.
      expect(envelopeFor("empty-record")).toBeUndefined();

      const result = execution.getResult() as any;
      expect(result.smallOrderId).toBe("ORD-42");
      expect(result.largeLength).toBe(300 * 1024);
      expect(result.nothingIsUndefined).toBe(true);

      assertEventSignatures(execution);
    });
  },
});
