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
 *   2. whole operations, oldest first.
 *
 * Execution `input`/`output` and identity/timeline fields are never dropped —
 * use `content.input`/`content.output` transforms to bound those. When anything
 * is dropped, the returned record has `truncated: true` and the
 * `droppedOperationResults` / `droppedOperations` counts.
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

  const candidate = (): WorkflowInsightRecord => {
    const out: WorkflowInsightRecord = {
      ...record,
      operations: ops.filter((_, i) => kept[i]),
      truncated: true,
    };
    if (droppedOperationResults > 0)
      out.droppedOperationResults = droppedOperationResults;
    if (droppedOperations > 0) out.droppedOperations = droppedOperations;
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

  // If nothing was actually dropped (e.g. an oversized input/output with no
  // operation data to shed), return the original untouched — it wasn't cut.
  if (droppedOperationResults === 0 && droppedOperations === 0) return record;

  return candidate();
}
