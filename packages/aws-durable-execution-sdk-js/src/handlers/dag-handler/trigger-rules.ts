import { TaskStatus, TriggerRule } from "../../types/dag";

/**
 * Evaluators for each {@link TriggerRule}, mapping the terminal statuses of a
 * task's upstream dependencies to whether the task should run.
 *
 * The empty-upstream case (a task with no deps) is well-defined:
 * success/done-family rules run (vacuously satisfied); failure-family rules
 * (`ALL_FAILED`, `ONE_FAILED`) skip because there is no actual upstream failure
 * — note the explicit `s.length > 0` guard on `ALL_FAILED`.
 *
 * `SKIPPED` counts as neither success nor failure.
 *
 * @experimental This value is experimental and may be changed or removed in future releases.
 */
export const triggerRuleEvaluators: Record<
  TriggerRule,
  (statuses: TaskStatus[]) => boolean
> = {
  ALL_SUCCESS: (s) => s.every((x) => x === "SUCCEEDED"),
  ALL_FAILED: (s) => s.length > 0 && s.every((x) => x === "FAILED"),
  ALL_DONE: () => true,
  ONE_SUCCESS: (s) => s.some((x) => x === "SUCCEEDED"),
  ONE_FAILED: (s) => s.some((x) => x === "FAILED"),
  NONE_FAILED: (s) => s.every((x) => x !== "FAILED"),
};
