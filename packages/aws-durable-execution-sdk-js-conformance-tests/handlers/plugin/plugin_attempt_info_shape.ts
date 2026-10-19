// 10-21: Attempt hook info field shape (canonical dump)
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
  DurableInstrumentationPlugin,
  InvocationInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

function iso(d?: Date): string | undefined {
  return d != null ? new Date(d).toISOString() : undefined;
}

function compact(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// CANONICAL DUMP of the CURRENT hook's own attempt info. Replay indicators
// (isReplay / isReplayingChildren) are dumped when the info exposes them but
// are not asserted here; attempt-end additionally carries outcome and error.
function dumpAttempt(hook: string, info: AttemptInfo): Record<string, unknown> {
  return {
    plugin: PLUGIN,
    hook,
    id: info.id,
    name: info.name,
    type: info.type != null ? info.type.toUpperCase() : undefined,
    subType: info.subType,
    parentId: info.parentId,
    attempt: info.attempt,
    startTimestamp: iso(info.startTimestamp),
    endTimestamp: iso(info.endTimestamp),
    isReplay: info.isReplay,
    isReplayingChildren: (info as AttemptInfo & { isReplayingChildren?: boolean })
      .isReplayingChildren,
  };
}

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(
      JSON.stringify({ ...compact(rec), durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      // ARN captured only for durableExecutionArn stamping (unasserted).
      executionArn = info.executionArn;
    },
    async onOperationAttemptStart(info: AttemptInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit(dumpAttempt("attempt-start", info));
    },
    async onOperationAttemptEnd(info: AttemptEndInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        ...dumpAttempt("attempt-end", info),
        // The attempt outcome as reported by the info (SUCCEEDED / FAILED).
        outcome: info.outcome,
        error: info.error != null ? info.error.message : undefined,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    return await context.step(
      "flaky",
      async (stepContext) => {
        // Real per-step attempt counter: fails attempt 1, succeeds attempt 2.
        if (stepContext.attempt < 2) {
          throw new Error(`Attempt ${stepContext.attempt} failed`);
        }
        return "ok";
      },
      {
        // Real built-in retry strategy: up to 2 attempts, deterministic ~1s delay.
        retryStrategy: createRetryStrategy({
          maxAttempts: 2,
          initialDelay: { seconds: 1 },
          jitter: JitterStrategy.NONE,
        }),
      },
    );
  },
  { plugins: [makePlugin()] },
);
