// The application in the MicroVM image that the MicroVM examples run.
//
// Lambda starts this process when it builds the image, and snapshots it. A
// MicroVM launched from the image resumes the snapshot. The worker then
// receives each job, runs it, and reports the result to the durable
// function's callback.
//
// scripts/ensure-microvm-image.ts bundles this file with its dependencies and
// builds the image. The integration tests pass the image ARN to the example
// functions.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startMicrovmWorker } from "@aws/durable-execution-sdk-js-microvm-worker";

const SESSION_DIR = "/tmp/session";

await startMicrovmWorker({
  // The microvm example sends its job in the run hook. A job that names no
  // route runs this handler.
  handler: async (input: unknown, context) => {
    const { text } = input as { text: string };
    return {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      sha256: createHash("sha256").update(text).digest("hex"),
      microvmId: context.microvmId,
    };
  },
  // The microvm-session example sends two jobs to the same MicroVM. The
  // second job reads the file that the first job wrote.
  routes: {
    "/write": async (input: unknown, context) => {
      const { key, value } = input as { key: string; value: string };
      await mkdir(SESSION_DIR, { recursive: true });
      await writeFile(join(SESSION_DIR, key), value);
      return { microvmId: context.microvmId };
    },
    "/read": async (input: unknown, context) => {
      const { key } = input as { key: string };
      return {
        microvmId: context.microvmId,
        value: await readFile(join(SESSION_DIR, key), "utf8"),
      };
    },
  },
});
