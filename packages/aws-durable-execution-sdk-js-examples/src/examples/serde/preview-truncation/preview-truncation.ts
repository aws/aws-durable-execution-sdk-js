import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DurableContext,
  withDurableExecution,
  createFileSystemSerdes,
  buildPreview,
  PreviewMode,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Preview Truncation",
  description:
    "buildPreview produces a compact, inline summary of a large offloaded value " +
    "for the console/API and telemetry. This example uses INCLUDE_ALL mode with " +
    "an exclude rule, and a small maxPreviewBytes so the preview is truncated " +
    "once the byte budget is reached (later fields are dropped).",
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
export const basePath = join(tmpdir(), "dur-example-preview-truncation");

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // Store on the filesystem and attach an inline preview. INCLUDE_ALL starts
    // with every field visible, then `exclude` drops the sensitive one. The
    // small maxPreviewBytes budget means only the first few fields fit — the
    // rest are truncated away.
    context.configureSerdes({
      defaultSerdes: createFileSystemSerdes(basePath, {
        generatePreview: (value) =>
          buildPreview(value, {
            mode: PreviewMode.INCLUDE_ALL,
            exclude: [{ name: "internalSecret" }],
            maxPreviewBytes: 128,
          }),
      }),
    });

    const record = await context.step("build-record", async () => ({
      id: "acct-123",
      region: "us-west-2",
      tier: "gold",
      internalSecret: "do-not-log-me",
      // Many additional fields so the preview budget is exhausted and later
      // entries are truncated.
      notes: "N".repeat(500),
      history: Array.from({ length: 50 }, (_, i) => ({ event: `evt-${i}` })),
    }));

    // `record` has already round-tripped through the serdes: a step returns
    // `deserialize(serialize(result))`, so the value below was read back out of
    // the file the serdes wrote. No replay (and so no durable mount) is needed.
    return await context.step("read-record", async () => ({
      id: record.id,
      tier: record.tier,
      notesLength: record.notes.length,
    }));
  },
);
