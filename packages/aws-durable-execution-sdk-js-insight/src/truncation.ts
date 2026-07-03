import type { OperationRecord, WorkflowInsightRecord } from "./types";

const encoder = new TextEncoder();

/** UTF-8 byte length of a value's JSON, or `undefined` if it can't be serialized. */
function jsonByteSize(value: unknown): number | undefined {
  try {
    return encoder.encode(JSON.stringify(value)).length;
  } catch {
    // Non-serializable payloads (e.g. bigint) can't be measured; the exporter's
    // own JSON.stringify would fail the same way, so we can't truncate here.
    return undefined;
  }
}

/**
 * Orders operation indices oldest-first for dropping. Sorts by `startTime`
 * ascending; operations without a parseable `startTime` (e.g. not-yet-started)
 * are treated as newest so they are dropped last. Stable within equal keys.
 */
function oldestFirstOrder(operations: OperationRecord[]): number[] {
  return operations
    .map((op, idx) => {
      const t = op.startTime ? Date.parse(op.startTime) : Number.NaN;
      return { idx, t: Number.isNaN(t) ? Number.POSITIVE_INFINITY : t };
    })
    .sort((a, b) => a.t - b.t || a.idx - b.idx)
    .map((x) => x.idx);
}

/**
 * Returns a copy of `record` shrunk to fit `maxBytes` (best-effort), or the
 * original record when it already fits or `maxBytes` is not set.
 *
 * Drop order (see `docs/plugin-contracts.md`):
 *   1. operation `result` fields, oldest operation first;
 *   2. whole operations, oldest first;
 *   3. last resort — execution `input`, then `output`.
 *
 * Identity/timeline fields (arn, status, timestamps, etc.) are never dropped.
 * `input`/`output` are dropped only after every operation is gone, so prefer
 * `content.input`/`content.output` transforms to bound them earlier. When
 * anything is dropped, the returned record has `truncated: true` and the
 * relevant markers (`droppedOperationResults` / `droppedOperations` counts,
 * `droppedInput` / `droppedOutput` flags).
 *
 * The input record is never mutated (the same instance is shared across
 * exporters, which may have different limits).
 */
export function truncateRecord(
  record: WorkflowInsightRecord,
  maxBytes: number | undefined,
): WorkflowInsightRecord {
  if (maxBytes === undefined || maxBytes <= 0) return record;

  const initialSize = jsonByteSize(record);
  if (initialSize === undefined || initialSize <= maxBytes) return record;

  // Clone operations (and each op we may edit) so we never touch the shared input.
  const ops: OperationRecord[] = record.operations.map((op) => ({ ...op }));
  const kept = new Array<boolean>(ops.length).fill(true);
  const order = oldestFirstOrder(ops);

  let droppedOperationResults = 0;
  let droppedOperations = 0;
  let droppedInput = false;
  let droppedOutput = false;

  const candidate = (): WorkflowInsightRecord => {
    const out: WorkflowInsightRecord = {
      ...record,
      operations: ops.filter((_, i) => kept[i]),
      truncated: true,
    };
    if (droppedOperationResults > 0)
      out.droppedOperationResults = droppedOperationResults;
    if (droppedOperations > 0) out.droppedOperations = droppedOperations;
    if (droppedInput) {
      out.input = undefined;
      out.droppedInput = true;
    }
    if (droppedOutput) {
      out.output = undefined;
      out.droppedOutput = true;
    }
    return out;
  };

  const fits = (): boolean => {
    const size = jsonByteSize(candidate());
    return size !== undefined && size <= maxBytes;
  };

  // Phase 1: drop operation results, oldest first.
  for (const idx of order) {
    if (fits()) break;
    if (kept[idx] && ops[idx].result !== undefined) {
      ops[idx] = { ...ops[idx], result: undefined };
      droppedOperationResults++;
    }
  }

  // Phase 2: drop whole operations, oldest first.
  for (const idx of order) {
    if (fits()) break;
    if (kept[idx]) {
      kept[idx] = false;
      droppedOperations++;
    }
  }

  // Phase 3 (last resort): drop execution input, then output. Only reached once
  // every operation is gone and the record is still over the limit.
  if (!fits() && record.input !== undefined) droppedInput = true;
  if (!fits() && record.output !== undefined) droppedOutput = true;

  // If nothing was actually dropped, return the original untouched — not cut.
  if (
    droppedOperationResults === 0 &&
    droppedOperations === 0 &&
    !droppedInput &&
    !droppedOutput
  ) {
    return record;
  }

  return candidate();
}
