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
  name: "Preview generation with truncation",
  description:
    "buildPreview produces a compact, inline summary of a large offloaded value " +
    "for the console/API and telemetry. This example uses INCLUDE_ALL mode with " +
    "an exclude rule, and a small maxPreviewBytes so the preview is truncated " +
    "once the byte budget is reached (later fields are dropped).",
};

const basePath = join(tmpdir(), "dur-example-preview-truncation");

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

    await context.wait({ seconds: 1 });

    return await context.step("read-record", async () => ({
      id: record.id,
      tier: record.tier,
      notesLength: record.notes.length,
    }));
  },
);
