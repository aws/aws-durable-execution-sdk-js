// Public exports for @aws/durable-execution-sdk-js-otel

// Execution Plugin
export { ExecutionOtelPlugin } from "./execution-plugin";

// Shared Plugin Config
export type {
  OtelPluginConfig,
  TracerProviderFactory,
} from "./otel-plugin-config";
export { ProviderSource } from "./otel-plugin-config";

// Invocation Plugin
export { InvocationOtelPlugin } from "./invocation-plugin";

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
