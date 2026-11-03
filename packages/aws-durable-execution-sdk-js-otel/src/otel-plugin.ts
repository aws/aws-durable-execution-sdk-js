import type { DurableInstrumentationPluginFactory } from "@aws/durable-execution-sdk-js";
import { createExecutionOtelPluginFactory } from "./execution-plugin";
import { createInvocationOtelPluginFactory } from "./invocation-plugin";
import type { OtelPluginConfig } from "./otel-plugin-config";

/** Configuration for selecting an OTel view and its existing plugin options. */
export interface OtelPluginFactoryOptions extends OtelPluginConfig {
  /** Parent operations under Workflow (default) or the current Invocation. */
  mode?: "execution" | "invocation";
}

/**
 * Create a factory for either durable OpenTelemetry view and register it in
 * `plugins`. The SDK creates a fresh plugin for every invocation. Provider setup
 * remains lazy, and the selected factory retains its exclusive-view registration.
 */
export function createOtelPluginFactory(
  options: OtelPluginFactoryOptions = {},
): DurableInstrumentationPluginFactory {
  const { mode = "execution", ...config } = options;
  switch (mode) {
    case "execution":
      return createExecutionOtelPluginFactory(config);
    case "invocation":
      return createInvocationOtelPluginFactory(config);
    default:
      throw new TypeError(
        'OTel plugin mode must be "execution" or "invocation".',
      );
  }
}
