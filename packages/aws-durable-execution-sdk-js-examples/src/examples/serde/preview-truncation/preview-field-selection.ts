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
      email: profile.customer.email,
      auditLength: profile.auditLog.length,
    }));
  },
);
