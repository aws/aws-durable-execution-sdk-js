// 10-5: Multiple registered plugins all receive lifecycle hooks
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Two instrumentation plugins registered together (order A, B). Each reports the
// invocation lifecycle under its own prefix. The SDK builds one instance per
// registered factory per invocation and delivers hooks to every instance.
//
// The execution ARN comes from the InvocationInfo handed to the factory and is
// stamped on every record as a top-level field, so the runner's CloudWatch JSON
// filter ($.durableExecutionArn) matches the raw log line.
function makeLifecyclePlugin(
  name: string,
): DurableInstrumentationPluginFactory {
  return {
    createPlugin: (invocation) => {
      const emit = (record: Record<string, unknown>): void => {
        process.stdout.write(
          JSON.stringify({
            ...record,
            durableExecutionArn: invocation.executionArn,
          }) + "\n",
        );
      };

      return {
        async onInvocationStart() {
          emit({ plugin: name, hook: "invocation-start" });
        },
        async onInvocationEnd(info) {
          emit({ plugin: name, hook: "invocation-end", status: info.status });
        },
      };
    },
  };
}

const pluginA = makeLifecyclePlugin("CONFPLUGIN-A");
const pluginB = makeLifecyclePlugin("CONFPLUGIN-B");

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [pluginA, pluginB] },
);
