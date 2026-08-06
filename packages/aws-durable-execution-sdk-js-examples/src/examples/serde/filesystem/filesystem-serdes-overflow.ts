import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DurableContext,
  withDurableExecution,
  createFileSystemSerdes,
  FileSystemSerdesMode,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Filesystem Serdes Overflow Mode",
  description:
    "OVERFLOW storage mode keeps small values inline in the checkpoint (as JSON) " +
    "and only spills to a file when a value would exceed the ~256KB checkpoint " +
    "size limit. Best for mixed workloads where most payloads are small. Also " +
    "shows that undefined results are passed through without writing a file.",
};

/**
 * In production `basePath` is a durable, shared mount (S3 Files / EFS). The OS
 * temp dir is fine here because this example reads every value back within the
 * invocation that wrote it — it demonstrates the serdes, not mount durability.
 */
export const basePath = join(tmpdir(), "dur-example-fs-serdes-overflow");

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    // OVERFLOW mode with the default URI path encoding. Small values are stored
    // inline; only oversized values overflow to a file.
    context.configureSerdes({
      defaultSerdes: createFileSystemSerdes(basePath, {
        storageMode: FileSystemSerdesMode.OVERFLOW,
      }),
    });

    // Small result: stays inline in the checkpoint as { data: "<json>" }.
    const small = await context.step("small-record", async () => ({
      orderId: "ORD-42",
      total: 19.99,
    }));

    // Large result (>256KB): the inline envelope would exceed the checkpoint
    // limit, so the serdes overflows it to a file and stores { file: "<path>" }.
    const large = await context.step("large-document", async () =>
      "L".repeat(300 * 1024),
    );

    // Undefined result: the serdes returns undefined without touching the
    // filesystem, and deserialize returns undefined on replay.
    const nothing = await context.step<undefined>(
      "empty-record",
      async () => undefined,
    );

    // No replay is needed to exercise deserialize: a step always returns
    // `deserialize(serialize(result))`, so each value above has already made the
    // round trip — the small one out of the inline envelope, the large one by
    // reading back the overflow file, and the undefined one straight through.
    return await context.step("combine", async () => ({
      smallOrderId: small.orderId,
      largeLength: large.length,
      nothingIsUndefined: nothing === undefined,
    }));
  },
);
