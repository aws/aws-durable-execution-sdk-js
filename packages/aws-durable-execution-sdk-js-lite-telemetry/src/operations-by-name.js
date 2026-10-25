// A port of withOperationsByName from the full SDK's telemetry exporter
// (src/operations-index.ts). The CloudWatch Logs exporter writes this form. Logs
// Insights cannot select "the array element named X". It can read a field path such as
// operationsByName.charge.status. So the record carries a map keyed by name.

// One summary per operation name:
// 1. count, failedCount and the durations sum up every operation with the name.
// 2. type, subType and status come from the last operation with the name. The SDK adds
//    records in start order, so the last one is the newest.
// 3. error is kept only when one operation has the name. A repeated name has no single
//    error.
// Operations without a name are skipped, because they have no key.
export function buildOperationsByName(operations) {
  // A Map, because an operation name such as "__proto__" would change the prototype of
  // a plain object.
  const groups = new Map();
  for (const op of operations) {
    if (!op.name) continue;
    const duration =
      typeof op.durationMs === "number" ? op.durationMs : undefined;
    const attempt = typeof op.attempt === "number" ? op.attempt : undefined;
    const failed = op.status === "FAILED" ? 1 : 0;
    const existing = groups.get(op.name);
    if (!existing) {
      const summary = {
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
      if (op.error !== undefined) summary.error = op.error;
      groups.set(op.name, summary);
      continue;
    }
    existing.count += 1;
    existing.failedCount += failed;
    existing.type = op.type;
    existing.status = op.status;
    if (op.subType !== undefined) existing.subType = op.subType;
    else delete existing.subType;
    if (duration !== undefined) {
      existing.minDurationMs = Math.min(
        existing.minDurationMs ?? duration,
        duration,
      );
      existing.maxDurationMs = Math.max(
        existing.maxDurationMs ?? duration,
        duration,
      );
      existing.totalDurationMs = (existing.totalDurationMs ?? 0) + duration;
    }
    if (attempt !== undefined) {
      existing.maxAttempt = Math.max(existing.maxAttempt ?? attempt, attempt);
    }
    delete existing.error;
  }
  // defineProperty creates an own property, also for the key "__proto__". An
  // assignment would call the prototype setter instead.
  const byName = {};
  for (const [name, summary] of groups) {
    Object.defineProperty(byName, name, {
      value: summary,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return byName;
}

// The record with operations replaced by operationsByName.
export function withOperationsByName(record) {
  const { operations, ...rest } = record;
  return { ...rest, operationsByName: buildOperationsByName(operations) };
}
