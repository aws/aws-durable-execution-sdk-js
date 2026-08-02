import type { DarNode, DarWorkflow } from "./darModel";
import { getServiceIntegration } from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { waitSpecOf } from "./strategy";

const SECONDS_PER: Record<string, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
};

/** One year in seconds — the Lambda durable-execution maximum. */
export const MAX_EXECUTION_TIMEOUT_SECONDS = 365 * 24 * 3600;

/** Minimum floor so trivial (wait-free) workflows still get a sane timeout. */
export const MIN_EXECUTION_TIMEOUT_SECONDS = 60;

function toSeconds(value: unknown, unit: unknown): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const mult = SECONDS_PER[typeof unit === "string" ? unit : "seconds"] ?? 1;
  return v * mult;
}

/**
 * A wait whose length cannot be known at synth time (a dynamic `durationCode`, or
 * a durable invoke into a workflow we cannot see). Propagates through the max/sum
 * arithmetic as Infinity so any path containing one is also unknown, and the
 * caller can then decline to infer rather than emit a confidently wrong timeout.
 */
export const UNKNOWN_WAIT = Number.POSITIVE_INFINITY;

/**
 * The durable wait a single node contributes on its own (not counting what runs
 * after it). Containers recurse into their own scope: a `parallel` runs branches
 * concurrently so it costs its **slowest** branch; `map`/`group` cost their body
 * (one iteration for map — item count is unknown).
 */
function selfWaitSeconds(node: DarNode): number {
  switch (node.kind) {
    case "wait": {
      // A dynamic duration (`durationCode`) is an arbitrary expression evaluated
      // at runtime, so its length is genuinely unknowable at synth time. Reading
      // only durationValue made it contribute 0, which silently inferred the 60s
      // floor for a wait that might be 30 days — the execution then dies
      // mid-flight. Since we cannot bound it, refuse to guess: signal
      // UNKNOWN_WAIT so the caller stops inferring and requires an explicit
      // executionTimeout instead of shipping a wrong one.
      if (
        typeof node.durationCode === "string" &&
        node.durationCode.trim() !== ""
      ) {
        return UNKNOWN_WAIT;
      }
      return toSeconds(node.durationValue, node.durationUnit);
    }
    case "callback":
      return toSeconds(node.timeoutValue, node.timeoutUnit);
    case "waitForCondition": {
      const spec = waitSpecOf(node);
      return spec.maxAttempts * spec.maxDelaySeconds;
    }
    // A durable invoke runs another workflow whose own timeout we cannot see from
    // here, so its duration is unbounded as far as this analysis goes. Previously
    // contributed 0, making a chain of long-running durable functions invisible.
    case "chainInvoke":
      return UNKNOWN_WAIT;
    case "awsJob": {
      const preset = getServiceIntegration(
        typeof node.integration === "string" ? node.integration : undefined,
      );
      return preset ? preset.maxWaitSeconds : 3600;
    }
    case "group":
    case "map":
      return node.body ? scopeWaitSeconds(node.body as DarWorkflow) : 0;
    case "parallel":
      return Math.max(
        0,
        // Branches can be null or body-less in hand-edited/partial .dar files —
        // `analyzePermissions.ts` guards this same shape. Without the guard this
        // threw "Cannot read properties of null (reading 'body')" and crashed
        // synth outright.
        ...(
          (node.branches as ({ body?: DarWorkflow } | null)[] | undefined) ?? []
        )
          .filter((b): b is { body?: DarWorkflow } => b != null)
          .map((b) => (b.body ? scopeWaitSeconds(b.body) : 0)),
      );
    default:
      return 0;
  }
}

/**
 * Worst-case durable wait along the **longest path** through one workflow scope
 * (sequential nodes sum; a `condition`'s branches — and a node's error routes —
 * are alternatives, so the longest one wins, not their sum). Cycles are guarded
 * (a back-edge contributes 0), so free-form loops count a single pass.
 */
function scopeWaitSeconds(wf: DarWorkflow): number {
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const addEdge = (source: string, target: string) => {
    const list = adj.get(source);
    if (list) list.push(target);
    else adj.set(source, [target]);
  };
  for (const e of wf.edges) addEdge(e.source, e.target);
  // Error-route edges are already in `wf.edges`; they're alternative
  // continuations, so the max over all outgoing edges covers them.

  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  /**
   * Why the memo is conditional.
   *
   * The cycle guard returns 0 for a node already on the current DFS stack. That 0
   * is correct only *for that path* — it means "don't count this loop twice". The
   * old code memoized the result anyway, so a node whose subtree was truncated by
   * the guard cached a short value, and every later path that reached it reused
   * that value even when no cycle was active there. The effect was not limited to
   * loops: it truncated acyclic branches downstream of any node that happened to
   * be visited during a cycle, which is broader than the "loops count a single
   * pass" behaviour the docs describe. On the reported counterexample this
   * produced 192 where 204 is correct.
   *
   * So a result is cached only when nothing beneath it was truncated. Truncated
   * results stay path-local and are recomputed, which costs re-traversal on
   * cyclic graphs but cannot leak a wrong number into an unrelated path.
   */
  const longestFrom = (id: string): { total: number; truncated: boolean } => {
    const cached = memo.get(id);
    if (cached !== undefined) return { total: cached, truncated: false };
    if (visiting.has(id)) return { total: 0, truncated: true }; // cycle guard
    visiting.add(id);
    const node = byId.get(id);
    const self = node ? selfWaitSeconds(node) : 0;
    let downstream = 0;
    let truncated = false;
    for (const t of adj.get(id) ?? []) {
      const r = longestFrom(t);
      truncated = truncated || r.truncated;
      downstream = Math.max(downstream, r.total);
    }
    visiting.delete(id);
    const total = self + downstream;
    if (!truncated) memo.set(id, total);
    return { total, truncated };
  };

  const start = wf.nodes.find((n) => n.kind === "start");
  if (start) return longestFrom(start.id).total;
  // No start (partial/hand-edited): fall back to the worst single node path.
  return Math.max(0, ...wf.nodes.map((n) => longestFrom(n.id).total));
}

/**
 * Infers a safe `executionTimeout` (seconds) for a workflow: the worst-case
 * durable wait along its longest path (see {@link scopeWaitSeconds}) plus a 20%
 * buffer, floored at {@link MIN_EXECUTION_TIMEOUT_SECONDS} and capped at one
 * year. A path containing an unbounded wait (see {@link UNKNOWN_WAIT}) yields
 * Infinity here, which the cap turns into the one-year maximum — deliberately
 * erring long, since a too-short timeout kills a live execution while a too-long
 * one only delays a failure. Use {@link hasUnboundedWait} to detect that case and
 * ask the user for an explicit value.
 *
 * Taking the longest path (rather than summing every branch) avoids
 * wildly over-estimating workflows with conditions, error routes, or parallel
 * branches, while still being an upper bound on a single execution.
 */
export function inferExecutionTimeoutSeconds(wf: DarWorkflow): number {
  const waits = scopeWaitSeconds(wf);
  const withBuffer = MIN_EXECUTION_TIMEOUT_SECONDS + Math.ceil(waits * 1.2);
  return Math.min(
    Math.max(withBuffer, MIN_EXECUTION_TIMEOUT_SECONDS),
    MAX_EXECUTION_TIMEOUT_SECONDS,
  );
}

/**
 * Whether the workflow contains a wait this analysis cannot bound — a dynamic
 * `durationCode`, or a `chainInvoke` into a workflow whose own timeout is not
 * visible here. When true, {@link inferExecutionTimeoutSeconds} returns the
 * one-year cap rather than a meaningful estimate, so callers should prefer an
 * explicit `executionTimeout`.
 */
export function hasUnboundedWait(wf: DarWorkflow): boolean {
  return !Number.isFinite(scopeWaitSeconds(wf));
}
