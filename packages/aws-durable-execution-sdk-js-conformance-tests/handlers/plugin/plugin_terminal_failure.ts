// 10-7: Plugin invocation-end hook receives FAILED status when execution fails
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  retryPresets,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports the invocation lifecycle via CloudWatch.
// The single step always throws with no retries, so the execution fails and the
// invocation-end hook fires with the FAILED terminal status.
//
// One instance serves one invocation, so the execution ARN is taken from the
// InvocationInfo handed to the factory and stamped on every record as a
// top-level field (the runner's CloudWatch JSON filter is $.durableExecutionArn).
const terminalFailurePlugin: DurableInstrumentationPluginFactory = {
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
      async onInvocationStart(info) {
        emit({
          plugin: "CONFPLUGIN",
          hook: "invocation-start",
          first: info.isFirstInvocation,
        });
      },
      async onInvocationEnd(info) {
        emit({
          plugin: "CONFPLUGIN",
          hook: "invocation-end",
          status: info.status,
        });
      },
    };
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        throw new Error("Something went wrong");
      },
      { retryStrategy: retryPresets.noRetry },
    );
    return result;
  },
  { plugins: [terminalFailurePlugin] },
);
