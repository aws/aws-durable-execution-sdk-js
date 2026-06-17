// Public exports for @aws/durable-execution-sdk-js-otel

// Plugin
export { DurableExecutionOtelPlugin } from "./plugin";
export type { DurableExecutionOtelPluginConfig } from "./plugin";

// ID Generator
export {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
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
