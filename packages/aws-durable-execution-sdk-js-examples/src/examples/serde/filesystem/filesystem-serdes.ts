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
  name: "Filesystem Serdes Always Mode",
  description:
    "Stores step results on a durable, shared filesystem (e.g. an S3 Files or " +
    "EFS mount) instead of inline in the checkpoint. The checkpoint keeps only " +
    "a file pointer plus a small inline preview, so large payloads never bloat " +
    "the execution history. Demonstrates ALWAYS storage mode, HASH path " +
    "encoding, and generatePreview.",
};

/**
 * Where the serdes writes its files.
 *
 * The SDK's own guidance for `createFileSystemSerdes` is explicit: do NOT use
 * Lambda's ephemeral `/tmp`. It is local to one execution environment, so a
 * replay landing on a different one cannot read the file back. Production points
 * this at a durable, shared mount — `/mnt/s3` (S3 Files) or `/mnt/efs` (EFS).
 *
 * An OS temp dir is nonetheless correct for THIS example, because it never reads
 * across invocations: a step returns `deserialize(serialize(result))`, so the
 * value is written and read back inside the one invocation that produced it. The
 * test pins that with a single-invocation assertion. Copying this snippet into a
 * handler that resumes after a wait or a callback would need a real mount.
 */
export const basePath = join(tmpdir(), "dur-example-fs-serdes-always");

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
