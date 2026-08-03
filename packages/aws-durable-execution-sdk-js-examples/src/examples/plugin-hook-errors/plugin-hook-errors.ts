import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

/**
 * A deliberately misbehaving instrumentation plugin: every lifecycle hook
 * throws. Instrumentation is best-effort — a buggy plugin must never change the
 * outcome of a durable execution. The SDK's plugin runner isolates these
 * failures:
 *
 * - The `wrap*` hooks (`wrapInvocation`, `wrapChildContextFn`,
 *   `wrapOperationAttemptFn`) throw *before* delegating to the wrapped
 *   function. The runner catches the throw and still invokes the wrapped
 *   function, so the operation runs exactly as if the plugin were absent.
 * - The non-wrapping notification hooks (`onInvocation*`, `onOperation*`) throw
 *   too; their rejections are swallowed by the runner.
 * - `enrichLogContext` throws; the runner ignores that plugin's contribution
 *   rather than failing the log call.
 *
 * The workflow below therefore completes successfully, and a failing step's
 * error still surfaces to the workflow (the plugin runner re-throws a wrapped
 * function's rejection so plugins observe it, without suppressing it).
 */
const misbehavingPlugin: DurableInstrumentationPlugin = {
  onInvocationStart() {
    throw new Error("plugin onInvocationStart boom");
  },
  onInvocationEnd() {
    throw new Error("plugin onInvocationEnd boom");
  },
  onOperationStart() {
    throw new Error("plugin onOperationStart boom");
  },
  onOperationEnd() {
    throw new Error("plugin onOperationEnd boom");
  },
  onOperationAttemptStart() {
    throw new Error("plugin onOperationAttemptStart boom");
  },
  onOperationAttemptEnd() {
    throw new Error("plugin onOperationAttemptEnd boom");
  },
  onOperationChange() {
    throw new Error("plugin onOperationChange boom");
  },
  wrapInvocation() {
    throw new Error("plugin wrapInvocation boom");
  },
  wrapChildContextFn() {
    throw new Error("plugin wrapChildContextFn boom");
  },
  wrapOperationAttemptFn() {
    throw new Error("plugin wrapOperationAttemptFn boom");
  },
  enrichLogContext() {
    throw new Error("plugin enrichLogContext boom");
  },
};

export const config: ExampleConfig = {
  name: "Plugin Hook Errors",
  description:
    "A misbehaving instrumentation plugin whose every lifecycle hook throws " +
    "does not affect execution: the SDK swallows plugin errors and falls " +
    "through to the wrapped function, so the workflow completes normally, " +
    "including recovering from a failing step.",
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Triggers enrichLogContext (which throws) — the log call still succeeds.
    context.logger.info("Starting workflow with a misbehaving plugin");

    // A normal step: wrapOperationAttemptFn throws, the runner falls through to
    // the attempt, and the step succeeds.
    const greeting = await context.step("greet", async () => "hello");

    // A child context: wrapChildContextFn throws, the runner falls through, and
    // the nested step runs.
    const childResult = await context.runInChildContext(
      "child",
      async (childContext) => {
        return await childContext.step("child-step", async () => "child-done");
      },
    );

    // A failing step: its rejected attempt promise is captured by the plugin
    // runner's guarded function and re-thrown so plugins still observe the
    // error, then surfaces to the workflow — which recovers from it.
    let recovered = false;
    try {
      await context.step(
        "failing-step",
        async () => {
          throw new Error("intentional step failure");
        },
        { retryStrategy: retryPresets.noRetry },
      );
    } catch {
      recovered = true;
    }

    return { greeting, childResult, recovered };
  },
  { plugins: [misbehavingPlugin] },
);
