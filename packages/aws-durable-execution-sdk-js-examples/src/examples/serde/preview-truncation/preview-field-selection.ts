import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DurableContext,
  withDurableExecution,
  createFileSystemSerdes,
  buildPreview,
  PreviewMode,
  FieldMatchMode,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Preview Field Selection",
  description:
    "buildPreview with EXCLUDE_ALL mode: nothing is shown unless explicitly " +
    "included. Demonstrates name matching at any depth (ANYWHERE, the default), " +
    "exact dot-path matching (PATH), and masking a sensitive field so its value " +
    "is replaced with a mask string in the preview.",
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
export const basePath = join(tmpdir(), "dur-example-preview-field-selection");

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    context.configureSerdes({
      defaultSerdes: createFileSystemSerdes(basePath, {
        generatePreview: (value) =>
          buildPreview(value, {
            mode: PreviewMode.EXCLUDE_ALL,
            include: [
              // Match `id` wherever it appears in the tree (default ANYWHERE).
              { name: "id" },
              // Match only the exact nested path, not any `email` elsewhere.
              { name: "customer.email", match: FieldMatchMode.PATH },
            ],
            // Masked fields are shown but their value is redacted.
            mask: [{ name: "ssn" }],
          }),
      }),
    });

    const profile = await context.step("build-profile", async () => ({
      id: "cust-9",
      status: "active",
      // A decoy: same field NAME as `customer.email` but at a different path.
      // PATH matching must not pick this up. Without it, a PATH implementation
      // loosened to a suffix match would still pass.
      email: "decoy@example.com",
      customer: {
        id: "cust-9",
        email: "person@example.com",
        ssn: "123-45-6789",
      },
      // Sensitive body that EXCLUDE_ALL keeps out of the preview entirely.
      auditLog: "A".repeat(2000),
    }));

    // `profile` has already round-tripped through the serdes: a step returns
    // `deserialize(serialize(result))`, so the value below was read back out of
    // the file the serdes wrote. No replay (and so no durable mount) is needed.
    return await context.step("read-profile", async () => ({
      id: profile.id,
      email: profile.email,
      customerEmail: profile.customer.email,
      auditLength: profile.auditLog.length,
    }));
  },
);
