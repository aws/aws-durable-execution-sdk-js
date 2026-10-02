// The application inside the MicroVM image that the end-to-end test builds.
// Lambda starts it at image build and snapshots it. The run hook then
// delivers each job.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type MicrovmJobHandler,
  type MicrovmWorkerLogger,
  startMicrovmWorker,
} from "@aws/durable-execution-sdk-js-microvm-worker";

interface E2eJob {
  mode: "succeed" | "fail" | "crash";
  sleepSeconds: number;
  label: string;
  padding?: string;
}

const SESSION_DIR = "/tmp/session";

// Only the process memory holds this value. A job that reads it back after a
// suspend shows that the resume restored the memory.
let remembered: { value: string; storedAt: string } | undefined;

// Counts the resume lifecycle hooks that the worker logged. A job that
// reports a count above zero shows that the service called the hook after
// the worker suspended its own MicroVM.
let resumeHooks = 0;
const write =
  (level: string, sink: (line: string) => void) =>
  (message: string, data?: Record<string, unknown>): void => {
    if (message === "lifecycle hook" && data?.hook === "resume") {
      resumeHooks++;
    }
    sink(JSON.stringify({ level, message, ...data }));
  };
const logger: MicrovmWorkerLogger = {
  info: write("INFO", console.log),
  warn: write("WARN", console.warn),
  error: write("ERROR", console.error),
};

const runJob: MicrovmJobHandler<E2eJob, unknown> = async (job, context) => {
  context.logger.info("job received", { job });
  if (job.mode === "crash") {
    // Exits after the first heartbeat. The durable function must then fail
    // on the heartbeat timeout, well before the callback timeout.
    setTimeout(() => process.exit(1), 2_000);
    return new Promise(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, job.sleepSeconds * 1_000));
  if (job.mode === "fail") {
    throw new Error(`job ${job.label} failed on purpose`);
  }
  return {
    label: job.label,
    microvmId: context.microvmId,
    node: process.version,
    inputLength: JSON.stringify(job).length,
    // Echoed so that a test can compare what the MicroVM received.
    padding: job.padding,
    finishedAt: new Date().toISOString(),
  };
};

// The worker runs `handler` for a job that names no route: a small job
// arrives in the run hook, and a large one over HTTP on the worker's default
// job path. The /job route receives jobs from microvm() with
// request: { path: "/job" }.
await startMicrovmWorker<E2eJob, unknown>({
  logger,
  handler: runJob,
  routes: {
    "/job": runJob,
    // A session writes a file with one job and reads it with the next.
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
    "/remember": async (input: unknown, context) => {
      const { value } = input as { value: string };
      remembered = { value, storedAt: new Date().toISOString() };
      return { microvmId: context.microvmId, pid: process.pid };
    },
    "/recall": async (_input: unknown, context) => ({
      microvmId: context.microvmId,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      resumeHooks,
      ...remembered,
    }),
  },
});
