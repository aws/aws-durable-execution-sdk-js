// Public exports for @aws/durable-execution-sdk-js-otel
//
// ExecutionOtelPlugin and InvocationOtelPlugin are deliberately not exported.
// A plugin is installed only by passing a factory in `plugins` or by naming a
// provider entry point in DURABLE_EXECUTION_PLUGINS, and the classes' single
// constructor takes the package-internal OtelPluginEnvironment plus the SDK's
// InvocationInfo for that invocation — so a customer cannot construct one, and
// exporting them would advertise a constructor nobody outside this package can
// call. They stay module-level exports for the provider entry points and this
// package's tests.

// Execution Plugin
export { createExecutionOtelPluginFactory } from "./execution-plugin";

// Shared Plugin Config
export type {
  IdGeneratorFactory,
  OtelPluginConfig,
  TracerProviderFactory,
} from "./otel-plugin-config";

// Invocation Plugin
export { createInvocationOtelPluginFactory } from "./invocation-plugin";

// ID Generator
export {
  DeterministicIdGenerator,
  deriveTraceIdFromXRayRoot,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
  deriveExecutionRootSpanId,
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

// Execution Trace Identity
export { deriveExecutionTraceId } from "./execution-trace-context";
export type { ExecutionTraceEnvironment } from "./execution-trace-context";
