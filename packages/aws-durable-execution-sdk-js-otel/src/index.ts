// Public exports for @aws/durable-execution-sdk-js-otel

// Execution Plugin
export { ExecutionOtelPlugin } from "./execution-plugin";

// Shared Plugin Config
export type { OtelPluginConfig } from "./otel-plugin-config";
/**
 * @deprecated Use `OtelPluginConfig` instead.
 */
export type { ExecutionOtelPluginConfig } from "./otel-plugin-config";

// Invocation Plugin
export { InvocationOtelPlugin } from "./invocation-plugin";
/**
 * @deprecated Use `OtelPluginConfig` instead.
 * This type alias is kept for backward compatibility.
 */
export type { InvocationOtelPluginConfig } from "./invocation-plugin";

// ID Generator
export {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
} from "./deterministic-id-generator";

// Context Extractors
export {
  xRayContextExtractor,
  w3cClientContextExtractor,
} from "./context-extractors";
export type {
  ContextExtractor,
  ContextExtractorResult,
} from "./context-extractors";
