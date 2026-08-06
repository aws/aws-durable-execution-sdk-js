import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DurableContext,
  withDurableExecution,
  createFileSystemSerdes,
  FileSystemSerdesMode,
  FileSystemPathEncoding,
  buildPreview,
  PreviewMode,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Filesystem Serdes (ALWAYS mode)",
  description:
    "Stores step results on a durable, shared filesystem (e.g. an S3 Files or " +
    "EFS mount) instead of inline in the checkpoint. The checkpoint keeps only " +
    "a file pointer plus a small inline preview, so large payloads never bloat " +
    "the execution history. Demonstrates ALWAYS storage mode, HASH path " +
    "encoding, and generatePreview.",
};

/**
 * A generated document large enough that you would not want it stored inline in
 * every checkpoint. In production `basePath` points at a durable, shared mount
 * such as `/mnt/s3` (S3 Files) or `/mnt/efs` (EFS) — NOT Lambda's ephemeral
 * `/tmp`, which is not shared across invocations. The OS temp dir is fine here
 * because this example deliberately reads the value back within the invocation
 * that wrote it: the point is that the serdes round-trips correctly, not that
 * the underlying mount is durable.
 */
const basePath = join(tmpdir(), "dur-example-fs-serdes-always");

interface GeneratedReport {
  id: string;
  status: string;
  ownerEmail: string;
  // A large body that we do not want stored inline in the checkpoint.
  body: string;
}

export const handler = withDurableExecution(
  async (event: { reportId: string }, context: DurableContext) => {
    // Configure a filesystem-backed serdes as the default for all operations.
    // - ALWAYS: every value is written to a file; the checkpoint stores a pointer.
    // - HASH: ARN (directory) and entity id (file name) are SHA-256 hashed, so
    //   the on-disk names are always filesystem-safe and fixed length.
    // - generatePreview: a small, human-readable summary is stored inline in the
    //   checkpoint envelope so the value is visible in the console/API without
    //   reading the full file. The owner's email is masked.
    context.configureSerdes({
      defaultSerdes: createFileSystemSerdes(basePath, {
        storageMode: FileSystemSerdesMode.ALWAYS,
        pathEncoding: FileSystemPathEncoding.HASH,
        generatePreview: (value) =>
          buildPreview(value, {
            mode: PreviewMode.EXCLUDE_ALL,
            include: [{ name: "id" }, { name: "status" }],
            mask: [{ name: "ownerEmail" }],
          }),
      }),
    });

    // Step 1: produce a large report. The serdes writes it to a file and the
    // checkpoint stores only { file, preview }.
    const report = await context.step(
      "generate-report",
      async (): Promise<GeneratedReport> => ({
        id: event.reportId,
        status: "generated",
        ownerEmail: "owner@example.com",
        body: "REPORT-".repeat(20_000), // ~140KB body
      }),
    );

    // Step 2: use the rehydrated value, proving the file round-tripped. No
    // replay is needed to exercise deserialize: a step always returns
    // `deserialize(serialize(result))` so that its first-run value is identical
    // to the one a later replay would reconstruct. `report` here has therefore
    // already been read back out of the file the serdes wrote.
    const summary = await context.step("summarize-report", async () => ({
      id: report.id,
      status: report.status,
      bodyLength: report.body.length,
    }));

    return summary;
  },
);
