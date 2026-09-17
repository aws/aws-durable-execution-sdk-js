// 10-16: Invocation-end fires for every invocation, non-terminal on suspension and terminal at completion
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";
const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);

const makePlugin: DurableInstrumentationPluginFactory = (invocation) => {
  // Same-invocation flag, read from the InvocationInfo this instance was built
  // for and stamped on its invocation-end record. Unlike Python/Java, the JS
  // InvocationEndInfo does not expose isFirstInvocation, so it has to be
  // carried over from the invocation's own identity. The SDK builds one
  // instance per invocation, so this closure cannot be reached by any other
  // invocation — including a concurrent one in the same execution environment.
  const first = invocation.isFirstInvocation;
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({
        ...rec,
        durableExecutionArn: invocation.executionArn,
      }) + "\n",
    );
  };

  return {
    async onInvocationStart(info): Promise<void> {
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
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [makePlugin] },
);
