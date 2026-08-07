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
