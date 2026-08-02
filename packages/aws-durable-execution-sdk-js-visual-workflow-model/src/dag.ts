/**
 * DAG (`dependencyMode: "dag"`) format additions for the `.dar` model, shared by
 * the Studio authoring model and the CDK code generator so the two cannot
 * drift. These types are additive and only meaningful when a scope's
 * `dependencyMode` is `"dag"`; they map 1:1 onto the SDK's `context.dag(...)`
 * surface (`TriggerRule`, `DagConfig`, `CompletionConfig`).
 */

/**
 * Trigger rules governing when a DAG task runs relative to its dependencies —
 * the six rules exposed by the SDK's `dag.*` operations. Default is
 * `"ALL_SUCCESS"` when a node omits `triggerRule`.
 *
 *   - `"ALL_SUCCESS"` — run once every dependency has SUCCEEDED (default).
 *   - `"ALL_FAILED"`  — run once every dependency has FAILED.
 *   - `"ALL_DONE"`    — run once every dependency has settled (succeeded,
 *                       failed, or skipped), regardless of outcome.
 *   - `"ANY_SUCCESS"` — run as soon as any one dependency has SUCCEEDED.
 *   - `"ANY_FAILED"`  — run as soon as any one dependency has FAILED.
 *   - `"NONE_FAILED"` — run once every dependency has settled and none FAILED.
 */
export type TriggerRule =
  | "ALL_SUCCESS"
  | "ALL_FAILED"
  | "ALL_DONE"
  | "ANY_SUCCESS"
  | "ANY_FAILED"
  | "NONE_FAILED";

/**
 * Runtime list of every {@link TriggerRule} (mirrors the `DAR_NODE_KINDS`
 * pattern), for dropdowns, validation, and schema generation. The first entry,
 * `"ALL_SUCCESS"`, is the default when a node omits `triggerRule`.
 */
export const TRIGGER_RULES = [
  "ALL_SUCCESS",
  "ALL_FAILED",
  "ALL_DONE",
  "ANY_SUCCESS",
  "ANY_FAILED",
  "NONE_FAILED",
] as const;

/**
 * How a `dag`-mode scope nests its child contexts, mirroring the SDK's
 * `NestingType`: `"NESTED"` creates a checkpointed child context per task
 * (higher observability/cost), `"FLAT"` skips per-task context wrapping
 * (~30% cheaper, higher scale). Default is `"NESTED"` when absent.
 */
export type DagNestingKind = "FLAT" | "NESTED";

/**
 * Threshold form of a DAG's early-completion policy — the DAG completes once
 * the given counts are reached, draining rather than fail-fast. All fields are
 * optional; mutually exclusive with {@link DagCustomCompletionConfigSpec}
 * (enforced by validation, mirroring the SDK's `never` fields). Maps to the
 * SDK's `ThresholdCompletionConfig`.
 */
export interface DagThresholdCompletionConfigSpec {
  /** Complete early once this many tasks have SUCCEEDED. */
  minSuccessful?: number;
  /** Absolute number of failed tasks tolerated before the DAG fails. */
  toleratedFailureCount?: number;
  /** Percentage (0–100) of failed tasks tolerated before the DAG fails. */
  toleratedFailurePercentage?: number;
}

/**
 * Custom form of a DAG's early-completion policy — a TypeScript predicate body
 * evaluated against the DAG's progress, emitted as
 * `{ shouldComplete: (status) => <body> }`. Mutually exclusive with the
 * threshold fields. Maps to the SDK's `CustomCompletionConfig`.
 */
export interface DagCustomCompletionConfigSpec {
  /** TypeScript predicate body over the completion status (a `CompletionDecision`). */
  shouldComplete: string;
}

/**
 * A DAG's early-completion policy: either the threshold form
 * ({@link DagThresholdCompletionConfigSpec}) or the custom predicate form
 * ({@link DagCustomCompletionConfigSpec}) — the two are mutually exclusive
 * (enforced by validation). Maps to the SDK's `CompletionConfig`.
 */
export type DagCompletionConfigSpec =
  | DagThresholdCompletionConfigSpec
  | DagCustomCompletionConfigSpec;

/**
 * Workflow-level DAG configuration, only meaningful when a scope's
 * `dependencyMode` is `"dag"`. Maps straight to the SDK's `DagConfig`. All
 * fields are optional; absent fields take the SDK defaults (e.g.
 * `maxConcurrency` 40, `nesting` `"NESTED"`, `defaultTriggerRule`
 * `"ALL_SUCCESS"`).
 */
export interface DagConfigSpec {
  /** Maximum number of tasks allowed to run concurrently (SDK default 40). */
  maxConcurrency?: number;
  /** Early-completion policy (threshold or custom predicate). */
  completionConfig?: DagCompletionConfigSpec;
  /** Trigger rule applied to tasks that omit their own `triggerRule`. */
  defaultTriggerRule?: TriggerRule;
  /** Child-context nesting strategy for the DAG's tasks. */
  nesting?: DagNestingKind;
}
