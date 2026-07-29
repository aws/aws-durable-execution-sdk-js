// 10-19: Plugin replay flag for a non-terminal wait
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isWait(type?: string): boolean {
  return (type || "").toUpperCase() === "WAIT";
}

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
    },
    // Operation ids are deliberately not logged: branch event ids are
    // nondeterministic under concurrency, and the wait type + replay flag
    // alone identify the behavior under test.
    async onOperationStart(info): Promise<void> {
      if (!isWait(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-start",
        type: (info.type || "").toUpperCase(),
        replay: info.isReplay,
      });
    },
    async onOperationEnd(info): Promise<void> {
      if (!isWait(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-end",
        type: (info.type || "").toUpperCase(),
        status: info.status,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Both waits run concurrently (max-concurrency=2) so they pend
    // simultaneously; the 2s wait completes first, the 8s wait stays
    // non-terminal across the ~2s replay.
    const results = await context.parallel<string>(
      "waits",
      [
        async (ctx: DurableContext) => {
          await ctx.wait({ seconds: 2 });
          return "short-done";
        },
        async (ctx: DurableContext) => {
          await ctx.wait({ seconds: 8 });
          return "long-done";
        },
      ],
      { maxConcurrency: 2 },
    );
    return results.getResults();
  },
  { plugins: [makePlugin()] },
);
