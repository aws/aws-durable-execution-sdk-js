// 10-18: Plugin replay flag for a non-terminal wait
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
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
    },
    // Correlate by stable wait name because branch event ids are
    // nondeterministic under concurrency.
    async onOperationStart(info): Promise<void> {
      if (!isWait(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-start",
        type: (info.type || "").toUpperCase(),
        name: info.name,
        replay: info.isReplay,
        // Non-terminal at hook time, from the hook info's own operation state
        // (no end timestamp yet) — no cross-invocation state.
        pending: info.endTimestamp == null,
      });
    },
    async onOperationEnd(info): Promise<void> {
      if (!isWait(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-end",
        type: (info.type || "").toUpperCase(),
        name: info.name,
        status: info.status,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Both waits run concurrently (max-concurrency=2) so they pend
    // simultaneously; the 2s "short" wait completes first, while the 8s
    // "long" wait remains non-terminal across the first replay. Each wait uses
    // the SDK's real wait naming parameter for stable correlation.
    const results = await context.parallel<string>(
      "waits",
      [
        async (ctx: DurableContext) => {
          await ctx.wait("short", { seconds: 2 });
          return "short-done";
        },
        async (ctx: DurableContext) => {
          await ctx.wait("long", { seconds: 8 });
          return "long-done";
        },
      ],
      { maxConcurrency: 2 },
    );
    return results.getResults();
  },
  { plugins: [makePlugin()] },
);
