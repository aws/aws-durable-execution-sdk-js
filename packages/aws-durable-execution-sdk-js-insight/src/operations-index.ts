import type {
  OperationRecord,
  OperationSummary,
  WorkflowInsightRecord,
} from "./types";

/**
 * Picks the "last" occurrence of a same-named group: the one with the greatest
 * `startTime` (ISO-8601 strings sort chronologically). Missing timestamps sort
 * earliest, and ties resolve to the later array index (insertion order).
 */
function latestOccurrence(group: OperationRecord[]): OperationRecord {
  let last = group[0];
  for (let i = 1; i < group.length; i++) {
    if ((group[i].startTime ?? "") >= (last.startTime ?? "")) {
      last = group[i];
    }
  }
  return last;
}

function summarize(group: OperationRecord[]): OperationSummary {
  const durations = group
    .map((o) => o.durationMs)
    .filter((d): d is number => typeof d === "number");
  const attempts = group
    .map((o) => o.attempt)
    .filter((a): a is number => typeof a === "number");
  const last = latestOccurrence(group);

  const summary: OperationSummary = {
    type: last.type,
    count: group.length,
    failedCount: group.filter((o) => o.status === "FAILED").length,
    status: last.status,
  };

  if (last.subType !== undefined) summary.subType = last.subType;
  if (durations.length > 0) {
    summary.minDurationMs = Math.min(...durations);
    summary.maxDurationMs = Math.max(...durations);
    summary.totalDurationMs = durations.reduce((a, b) => a + b, 0);
  }
  if (attempts.length > 0) summary.maxAttempt = Math.max(...attempts);
  // A single occurrence is either a success (result) or a failure (error), so
  // the last occurrence naturally contributes at most one of these.
  if (last.result !== undefined) summary.result = last.result;
  if (last.error !== undefined) summary.error = last.error;

  return summary;
}

/**
 * Builds a name-keyed index of operation summaries from the canonical operations
 * array. Operations without a name are skipped (they can't be keyed or queried).
 *
 * Metric fields aggregate across all occurrences of a name; `type`/`subType`/
 * `status`/`result`/`error` come from the last occurrence. See
 * `docs/operations-shape.md`.
 */
export function buildOperationsByName(
  operations: OperationRecord[],
): Record<string, OperationSummary> {
  const groups = new Map<string, OperationRecord[]>();
  for (const op of operations) {
    if (!op.name) continue;
    const existing = groups.get(op.name);
    if (existing) existing.push(op);
    else groups.set(op.name, [op]);
  }

  const byName: Record<string, OperationSummary> = {};
  for (const [name, group] of groups) {
    byName[name] = summarize(group);
  }
  return byName;
}

/**
 * Returns the record augmented with an `operationsByName` index. Used by
 * point-access exporters (CloudWatch Logs, DynamoDB) whose stores can't filter
 * "the array element named X" but can dot-path into a name-keyed map.
 */
export function withOperationsByName(
  record: WorkflowInsightRecord,
): WorkflowInsightRecord & {
  operationsByName: Record<string, OperationSummary>;
} {
  return {
    ...record,
    operationsByName: buildOperationsByName(record.operations),
  };
}
