import {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationInfo,
} from "../../types/plugin";
import { createPluginRunner } from "./plugin-runner";

/**
 * Builds the composite plugin runner for one invocation.
 *
 * Calling `createPlugin` here is what bounds a plugin instance's lifetime: each
 * instance is created before the invocation's first hook fires, it is reachable
 * only from the runner this returns, and the SDK keeps that runner in a local of
 * the invocation — never in module state and never in a map keyed by execution —
 * so both become garbage once the invocation returns. Nothing an instance holds
 * is visible to the next invocation, or to a concurrent one sharing the
 * execution environment.
 *
 * `info` is the same object the runner then passes to `onInvocationStart`, so a
 * plugin can take its identity at construction instead of waiting for the first
 * hook.
 *
 * A `createPlugin` that throws, or that hands back nothing, is contained the way
 * a failing plugin hook is contained: that plugin sits out this invocation and
 * the remaining plugins keep their relative order and behaviour. Factories are
 * synchronous; unsupported Promise-like results are skipped, with rejections
 * observed so a JavaScript factory result cannot leak an unhandled rejection.
 *
 * @internal
 */
export function createInvocationPluginRunner(
  factories: readonly DurableInstrumentationPluginFactory[],
  info: InvocationInfo,
): DurableInstrumentationPlugin {
  const plugins: DurableInstrumentationPlugin[] = [];

  for (const factory of factories) {
    let plugin: DurableInstrumentationPlugin | null | undefined;
    try {
      plugin = factory.createPlugin(info);
      if (
        plugin != null &&
        typeof (plugin as { then?: unknown }).then === "function"
      ) {
        // Do not wait for or dispatch an async result: the factory contract is
        // synchronous. Still observe failures from untyped JavaScript providers.
        void Promise.resolve(plugin).catch(() => undefined);
        continue;
      }
    } catch {
      // Swallowed for the same reason hook errors are: instrumentation must not
      // decide whether an execution runs.
      continue;
    }

    if (plugin != null) {
      plugins.push(plugin);
    }
  }

  return createPluginRunner(plugins);
}
