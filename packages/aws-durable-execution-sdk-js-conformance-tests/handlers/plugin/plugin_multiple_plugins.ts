// 10-5: Multiple registered plugins all receive lifecycle hooks
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Two instrumentation plugins registered together (order A, B). Each reports the
// invocation lifecycle under its own prefix. The SDK delivers hooks to every
// registered plugin.
const pluginA: DurableInstrumentationPlugin = {
  async onInvocationStart() {
    console.log(`CONFPLUGIN-A invocation-start`);
  },
  async onInvocationEnd(info) {
    console.log(`CONFPLUGIN-A invocation-end status=${info.status}`);
  },
};

const pluginB: DurableInstrumentationPlugin = {
  async onInvocationStart() {
    console.log(`CONFPLUGIN-B invocation-start`);
  },
  async onInvocationEnd(info) {
    console.log(`CONFPLUGIN-B invocation-end status=${info.status}`);
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [pluginA, pluginB] },
);
