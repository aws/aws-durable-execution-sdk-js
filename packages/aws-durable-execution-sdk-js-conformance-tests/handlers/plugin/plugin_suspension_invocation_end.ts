// 10-16: Invocation-end fires for every invocation, non-terminal on suspension and terminal at completion
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";
const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  // Same-invocation flag: captured at invocation-start and stamped on the
  // matching invocation-end record (start and end of one invocation run in the
  // same process, so this carries no cross-invocation state). Unlike
  // Python/Java, the JS InvocationEndInfo does not expose isFirstInvocation —
  // only the start-hook InvocationInfo does — so start-capture is the only
  // real API path.
  let first = false;
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
      first = info.isFirstInvocation;
      emit({
        plugin: PLUGIN,
        hook: "invocation-start",
        first: info.isFirstInvocation,
      });
    },
    async onInvocationEnd(info): Promise<void> {
      const status = String(info.status);
      emit({
        plugin: PLUGIN,
        hook: "invocation-end",
        first,
        // terminal := reported status is SUCCEEDED or FAILED.
        terminal: TERMINAL.has(status),
        status,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [makePlugin()] },
);
