/**
 * The retry/wait strategy spec now lives in the shared
 * `@aws/durable-execution-sdk-js-visual-workflow-model` package (single source
 * of truth with the CDK generator). Re-exported here so existing
 * `./studioModel/strategy` and `./studioTypes` imports keep working.
 */
export {
  defaultStepRetry,
  defaultWaitStrategy,
  normalizeStrategy,
  type StrategyKind,
  type JitterKind,
  type RetryStrategySpec,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
