import type {
  OperationRecord,
  OperationSummary,
  WorkflowInsightRecord,
} from "./types";

/**
 * Builds a name-keyed index of operation summaries from the canonical operations
 * array, in a single pass. Operations without a name are skipped (they can't be
 * keyed or queried).
 *
 * For each named operation: if the name is not yet in the index, insert a
 * summary (including its `result`/`error`); if it is already present (a repeated
 * name — loops/retries/map), update the aggregate metrics and **drop
 * `result`/`error`**, since there is no single representative value for a name
 * that ran more than once. Scalar fields (`type`, `subType`, `status`) reflect
 * the most recently seen occurrence (the runtime appends newer operations to the
 * end of the array). See `docs/operations-shape.md`.
 */
export function buildOperationsByName(
  operations: OperationRecord[],
): Record<string, OperationSummary> {
  const byName: Record<string, OperationSummary> = {};

  for (const op of operations) {
    if (!op.name) continue;

    const duration =
      typeof op.durationMs === "number" ? op.durationMs : undefined;
    const attempt = typeof op.attempt === "number" ? op.attempt : undefined;
    const failed = op.status === "FAILED" ? 1 : 0;

    const existing = byName[op.name];
    if (!existing) {
      const summary: OperationSummary = {
        type: op.type,
        count: 1,
        failedCount: failed,
        status: op.status,
      };
      if (op.subType !== undefined) summary.subType = op.subType;
      if (duration !== undefined) {
        summary.minDurationMs = duration;
        summary.maxDurationMs = duration;
        summary.totalDurationMs = duration;
      }
      if (attempt !== undefined) summary.maxAttempt = attempt;
      if (op.result !== undefined) summary.result = op.result;
      if (op.error !== undefined) summary.error = op.error;
      byName[op.name] = summary;
      continue;
    }

    // Repeated name: aggregate and drop the per-occurrence result/error.
    existing.count += 1;
    existing.failedCount += failed;
    existing.type = op.type;
    existing.status = op.status;
    if (op.subType !== undefined) existing.subType = op.subType;
    if (duration !== undefined) {
      existing.minDurationMs =
        existing.minDurationMs === undefined
          ? duration
          : Math.min(existing.minDurationMs, duration);
      existing.maxDurationMs =
        existing.maxDurationMs === undefined
          ? duration
          : Math.max(existing.maxDurationMs, duration);
      existing.totalDurationMs = (existing.totalDurationMs ?? 0) + duration;
    }
    if (attempt !== undefined) {
      existing.maxAttempt =
        existing.maxAttempt === undefined
          ? attempt
          : Math.max(existing.maxAttempt, attempt);
    }
    delete existing.result;
    delete existing.error;
  }

  return byName;
}

/**
 * Returns the record with its `operations` array **replaced** by a name-keyed
 * `operationsByName` index. Used by point-access exporters (CloudWatch Logs,
 * DynamoDB) whose stores can't filter "the array element named X" but can
 * dot-path into a name-keyed map — so they carry the index instead of the array
 * (array-native exporters keep the `operations` array unchanged).
 */
export function withOperationsByName(record: WorkflowInsightRecord): Omit<
  WorkflowInsightRecord,
  "operations"
> & {
  operationsByName: Record<string, OperationSummary>;
} {
  const { operations, ...rest } = record;
  return { ...rest, operationsByName: buildOperationsByName(operations) };
}
