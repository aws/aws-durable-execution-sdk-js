import type { DarNode } from "./darModel";
import { requireExpression } from "./validateEmitted";
import {
  defaultStepRetry,
  defaultWaitStrategy,
  normalizeStrategy,
  type JitterKind,
  type RetryStrategySpec,
  type StrategyKind,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";

// The strategy spec + normalization now live in the shared visual-workflow-model
// package (single source of truth with the Studio); re-exported so existing
// `./strategy` imports keep working. The `emit*` helpers below are CDK-only
// (they turn a spec into generated SDK-builder code).
export { normalizeStrategy };
export type { RetryStrategySpec, StrategyKind, JitterKind };

/** Reads a step node's retry spec (normalized). */
export function retrySpecOf(node: DarNode): RetryStrategySpec {
  return normalizeStrategy(node.retry, defaultStepRetry());
}

/** Reads a waitForCondition node's polling spec (normalized). */
export function waitSpecOf(node: DarNode): RetryStrategySpec {
  return normalizeStrategy(node.wait, defaultWaitStrategy());
}

/**
 * Emits a `createRetryStrategy(...)` / `createLinearRetryStrategy(...)`
 * expression for a step's retry spec, recording the builder + `JitterStrategy`
 * in `imports` so the generated handler imports exactly what it uses.
 */
export function emitRetryStrategy(
  spec: RetryStrategySpec,
  imports: Set<string>,
): string {
  if (spec.kind === "none") {
    imports.add("createRetryStrategy");
    return "createRetryStrategy({ maxAttempts: 1 })";
  }
  imports.add("JitterStrategy");
  if (spec.kind === "linear") {
    imports.add("createLinearRetryStrategy");
    return (
      "createLinearRetryStrategy({ " +
      `maxAttempts: ${spec.maxAttempts}, ` +
      `initialDelay: { seconds: ${spec.initialDelaySeconds} }, ` +
      `increment: { seconds: ${spec.incrementSeconds} }, ` +
      `maxDelay: { seconds: ${spec.maxDelaySeconds} }, ` +
      `jitter: JitterStrategy.${spec.jitter} })`
    );
  }
  imports.add("createRetryStrategy");
  return (
    "createRetryStrategy({ " +
    `maxAttempts: ${spec.maxAttempts}, ` +
    `initialDelay: { seconds: ${spec.initialDelaySeconds} }, ` +
    `maxDelay: { seconds: ${spec.maxDelaySeconds} }, ` +
    `backoffRate: ${spec.backoffRate}, ` +
    `jitter: JitterStrategy.${spec.jitter} })`
  );
}

/**
 * Emits a `createWaitStrategy(...)` expression for a waitForCondition's polling
 * spec. The SDK only offers exponential wait backoff, so a "linear" spec is
 * approximated with `backoffRate: 1` (constant delay). Polling stops when
 * `stopExpr` (a boolean expression over `state`) is truthy; when absent, falls
 * back to the legacy `{ done: true }` convention for older `.dar` files.
 */
export function emitWaitStrategy(
  spec: RetryStrategySpec,
  imports: Set<string>,
  stopExpr?: string,
): string {
  imports.add("createWaitStrategy");
  const parts: string[] = [];
  if (spec.kind === "none") {
    parts.push("maxAttempts: 1");
  } else {
    imports.add("JitterStrategy");
    parts.push(`maxAttempts: ${spec.maxAttempts}`);
    parts.push(`initialDelay: { seconds: ${spec.initialDelaySeconds} }`);
    parts.push(`maxDelay: { seconds: ${spec.maxDelaySeconds} }`);
    parts.push(`backoffRate: ${spec.kind === "linear" ? 1 : spec.backoffRate}`);
    parts.push(`jitter: JitterStrategy.${spec.jitter}`);
  }
  parts.push(
    stopExpr
      ? // Validated as a single expression: it stays an expression by design
        // (it closes over `state`), but must not be able to close the
        // parenthesis and continue with statements. See requireExpression.
        `shouldContinuePolling: (state: any) => !(${requireExpression(
          stopExpr,
          "stop expression",
          "Wait strategy",
        )})`
      : "shouldContinuePolling: (state) => !(state && (state as { done?: boolean }).done)",
  );
  return `createWaitStrategy({ ${parts.join(", ")} })`;
}
