import type {
  ErrorRecord,
  OperationRecord,
  DurableExecutionTelemetryRecord,
} from "./types";

const encoder = new TextEncoder();

/** An error with its `cause` chain removed: `{ name, message }`, same key order. */
function withoutCause(error: ErrorRecord): ErrorRecord {
  return { name: error.name, message: error.message };
}

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
 *   1. every error `cause` (the execution `error` and every `operations[].error`;
 *      `operationsByName` is derived from `operations` by `render`), marked
 *      `droppedCauses: true`;
 *   2. operation `result` fields, oldest operation first;
 *   3. whole operations, oldest first;
 *   4. last resort — execution `input`, then `output`.
 *
 * Identity/timeline fields (arn, status, timestamps, etc.) and each error's own
 * `name`/`message` are never dropped.
 * `input`/`output` are dropped only after every operation is gone, so prefer
 * `content.input`/`content.output` transforms to bound them earlier. When
 * anything is dropped, the returned record has `truncated: true`; each operation
 * whose result was dropped is itself marked `truncated: true`, and
 * `droppedCauses` / `droppedOperations` / `droppedInput` / `droppedOutput`
 * markers are set as applicable.
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
  record: DurableExecutionTelemetryRecord,
  maxBytes: number | undefined,
  render: (r: DurableExecutionTelemetryRecord) => unknown = (r) => r,
): DurableExecutionTelemetryRecord {
  if (maxBytes === undefined || maxBytes <= 0) return record;

  const initialSize = jsonByteSize(render(record));
  if (initialSize === undefined || initialSize <= maxBytes) return record;

  // Clone operations (and each op we may edit) so we never touch the shared input.
  // Step 1 runs unconditionally once the record is over the limit: every
  // `cause` is removed in one go (no step cuts individual levels).
  let droppedCauses = false;
  const ops: OperationRecord[] = record.operations.map((op) => {
    if (op.error?.cause === undefined) return { ...op };
    droppedCauses = true;
    return { ...op, error: withoutCause(op.error) };
  });
  const executionError =
    record.error?.cause === undefined
      ? record.error
      : withoutCause(record.error);
  if (executionError !== record.error) droppedCauses = true;
  const kept = new Array<boolean>(ops.length).fill(true);
  const order = oldestFirstOrder(ops);

  let anyResultDropped = false;
  let droppedOperations = 0;
  let droppedInput = false;
  let droppedOutput = false;

  const candidate = (): DurableExecutionTelemetryRecord => {
    const out: DurableExecutionTelemetryRecord = {
      ...record,
      operations: ops.filter((_, i) => kept[i]),
      truncated: true,
    };
    if (droppedCauses) {
      out.error = executionError;
      out.droppedCauses = true;
    }
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

  // Smallest `n` in [0, count] for which `apply(n)` fits, where `apply(n)` sets
  // the state for the first `n` drops, or `count` when none fits. Each drop
  // normally shrinks the record, so a binary search finds the same `n` as
  // dropping one at a time, with O(log count) renders instead of one each.
  // A drop can grow the record when the removed JSON is smaller than its
  // marker; then the search may drop more than the linear first-fit did.
  const firstFitting = (count: number, apply: (n: number) => void): number => {
    apply(0);
    if (count === 0 || fits()) return 0;
    let lo = 1;
    let hi = count;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      apply(mid);
      if (fits()) hi = mid;
      else lo = mid + 1;
    }
    apply(lo);
    return lo;
  };

  // Phase 2: drop operation results, oldest first. The operation is kept and
  // marked `truncated` so consumers can tell its result was cut, not absent.
  const withResults = order.filter((idx) => ops[idx].result !== undefined);
  const base = ops.slice();
  firstFitting(withResults.length, (n) => {
    withResults.forEach((idx, j) => {
      ops[idx] =
        j < n
          ? { ...base[idx], result: undefined, truncated: true }
          : base[idx];
    });
    anyResultDropped = n > 0;
  });

  // Phase 3: drop whole operations, oldest first.
  firstFitting(order.length, (n) => {
    order.forEach((idx, j) => {
      kept[idx] = j >= n;
    });
    droppedOperations = n;
  });

  // Phase 4 (last resort): drop execution input, then output. Only reached once
  // every operation is gone and the record is still over the limit.
  if (!fits() && record.input !== undefined) droppedInput = true;
  if (!fits() && record.output !== undefined) droppedOutput = true;

  // If nothing was actually dropped, return the original untouched — not cut.
  if (
    !droppedCauses &&
    !anyResultDropped &&
    droppedOperations === 0 &&
    !droppedInput &&
    !droppedOutput
  ) {
    return record;
  }

  return candidate();
}
