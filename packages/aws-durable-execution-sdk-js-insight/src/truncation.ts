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
 * anything is dropped, the returned record has `truncated: true`; each operation
 * whose result was dropped is itself marked `truncated: true`, and
 * `droppedOperations` / `droppedInput` / `droppedOutput` markers are set as
 * applicable.
 *
 * The input record is never mutated (the same instance is shared across
 * exporters, which may have different limits).
 *
 * `render` maps the record to the exact value the exporter will serialize (e.g.
 * the `operationsByName` expansion), so the size check measures what is actually
 * emitted rather than the canonical record. It defaults to the identity. Note
 * this bounds the serialized record *body*, not any destination wire envelope
 * (DynamoDB type descriptors, CloudWatch Logs event framing, gzip, etc.);
 * exporters with non-trivial envelope overhead should keep `maxRecordSizeBytes`
 * below their hard limit to leave headroom.
 */
export function truncateRecord(
  record: WorkflowInsightRecord,
  maxBytes: number | undefined,
  render: (r: WorkflowInsightRecord) => unknown = (r) => r,
): WorkflowInsightRecord {
  if (maxBytes === undefined || maxBytes <= 0) return record;

  const initialSize = jsonByteSize(render(record));
  if (initialSize === undefined || initialSize <= maxBytes) return record;

  // Clone operations (and each op we may edit) so we never touch the shared input.
  const ops: OperationRecord[] = record.operations.map((op) => ({ ...op }));
  const kept = new Array<boolean>(ops.length).fill(true);
  const order = oldestFirstOrder(ops);

  let anyResultDropped = false;
  let droppedOperations = 0;
  let droppedInput = false;
  let droppedOutput = false;

  const candidate = (): WorkflowInsightRecord => {
    const out: WorkflowInsightRecord = {
      ...record,
      operations: ops.filter((_, i) => kept[i]),
      truncated: true,
    };
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
    const size = jsonByteSize(render(candidate()));
    return size !== undefined && size <= maxBytes;
  };

  // Phase 1: drop operation results, oldest first. The operation is kept and
  // marked `truncated` so consumers can tell its result was cut, not absent.
  for (const idx of order) {
    if (fits()) break;
    if (kept[idx] && ops[idx].result !== undefined) {
      ops[idx] = { ...ops[idx], result: undefined, truncated: true };
      anyResultDropped = true;
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
    !anyResultDropped &&
    droppedOperations === 0 &&
    !droppedInput &&
    !droppedOutput
  ) {
    return record;
  }

  return candidate();
}
