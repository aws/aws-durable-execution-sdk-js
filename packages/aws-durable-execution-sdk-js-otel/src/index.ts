// Public exports for @aws/durable-execution-sdk-js-otel

// Invocation Plugin
export { InvocationOtelPlugin } from "./invocation-plugin";
export type { InvocationOtelPluginConfig } from "./invocation-plugin";

// ID Generator
export {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
} from "./deterministic-id-generator";

// Execution Plugin
export { ExecutionOtelPlugin } from "./execution-plugin";
export type { ExecutionOtelPluginConfig } from "./execution-plugin-config";

// Context Extractors
export {
  xRayContextExtractor,
  w3cClientContextExtractor,
} from "./context-extractors";
export type {
  ContextExtractor,
  ContextExtractorResult,
} from "./context-extractors";
