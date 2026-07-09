// Public exports for @aws/durable-execution-sdk-js-otel

// Plugin
export { OtelPlugin } from "./plugin";
export type { OtelPluginConfig } from "./plugin";

// ID Generator
export {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
} from "./deterministic-id-generator";

// Standalone Plugin
export { StandaloneOtelPlugin } from "./standalone-plugin";
export type { StandaloneOtelPluginConfig } from "./standalone-plugin-config";

// Context Extractors
export {
  xRayContextExtractor,
  w3cClientContextExtractor,
} from "./context-extractors";
export type {
  ContextExtractor,
  ContextExtractorResult,
} from "./context-extractors";
