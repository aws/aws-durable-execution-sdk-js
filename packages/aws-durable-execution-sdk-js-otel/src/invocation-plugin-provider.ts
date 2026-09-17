import type { DurableInstrumentationPluginFactory } from "@aws/durable-execution-sdk-js";
import { createInvocationOtelPluginFactory } from "./invocation-plugin";

/**
 * The plugin factory the SDK installs when this module is listed in
 * `DURABLE_EXECUTION_PLUGINS`. It is called once per invocation, with that
 * invocation's info, and the instance it returns serves only that invocation:
 * the plugin's execution identity, its spans and its span map are per-execution,
 * and operation IDs are unique only within an execution, so one instance cannot
 * serve two concurrent executions.
 *
 * Every invocation shares one environment — the tracer provider resolution, the
 * deterministic ID generator installation and the sampler wrapper — created
 * lazily on the first invocation. Importing this module therefore resolves no
 * tracer provider and installs nothing.
 */
export const durableExecutionPluginProvider: DurableInstrumentationPluginFactory =
  createInvocationOtelPluginFactory();
