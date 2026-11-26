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
 * A small result is one whose JSON is 7 bytes or shorter (such as `true`, `1`
 * or `"ok"`). Clearing a result replaces `"result":<json>` with
 * `"truncated":true`, which is 16 bytes. So in a rendering that shows this
 * per-operation marker, such as the array form, clearing a small result makes
 * the record bigger. A rendering that hides the marker, such as the
 * `operationsByName` map, gets smaller when any result is cleared.
 *
 * Step 2 first measures the record with no result cleared. If it fits, it is
 * returned. If there are small results, step 2 then measures the record with
 * every small result cleared. If that record is smaller, the rendering hides
 * the marker, so small results are cleared like large ones. Otherwise small
 * results stay in the record, unmarked, and only large results are cleared.
 * Then steps 2 and 3 binary search how many results or operations to cut.
 * Each probe renders and measures one candidate record. So a record with n
 * operations is rendered about 2 * log2(n + 1) + 5 times, for any `render`.
 *
 * The search can cut more results or operations than cutting one at a time
 * would. Two cases are known:
 *   - In the `operationsByName` map, cutting one of two same-name operations
 *     makes the other one's `result` and `error` appear in the map. So the
 *     record can grow after a cut, in the by-name form and the by-name part of
 *     `both`. Then the search can cut extra old operations.
 *   - Step 2 decides with one measurement whether all small results are
 *     cleared. In `both` and in a custom `render`, clearing some small results
 *     can shrink the record while clearing others makes it bigger. Then the
 *     search can cut extra operations.
 * The chosen record always comes from a real measurement. So it never goes over
 * `maxBytes`, as long as dropping everything droppable makes it fit. Otherwise
 * the returned record is over `maxBytes`, as before.
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
  // rank[i] is the position of operation i in the oldest-first order.
  // small[i] is whether operation i has a result whose JSON is 7 bytes or
  // shorter. Such a result is smaller than the `"truncated":true` marker that
  // replaces it, so clearing it can make the record bigger.
  const order = oldestFirstOrder(ops);
  const rank = new Array<number>(ops.length);
  const small = new Array<boolean>(ops.length).fill(false);
  order.forEach((idx, r) => {
    rank[idx] = r;
    const result = ops[idx].result;
    if (result === undefined) return;
    const size = jsonByteSize(result);
    small[idx] = size !== undefined && size <= 7;
  });

  // resultRank[i] is the position of operation i among the operations whose
  // result can be cleared, in the oldest-first order, or Infinity if it cannot.
  // Small results are included only when `withSmall` is true.
  const resultRank = new Array<number>(ops.length);
  let clearable = 0; // the number of results that can be cleared
  const rankResults = (withSmall: boolean): void => {
    resultRank.fill(Number.POSITIVE_INFINITY);
    clearable = 0;
    for (const idx of order) {
      if (ops[idx].result === undefined) continue;
      if (small[idx] && !withSmall) continue;
      resultRank[idx] = clearable++;
    }
  };
  rankResults(false);
  let clearSmall = false; // set only to measure the record with small results cleared

  let resultsDropped = 0; // the oldest `resultsDropped` clearable results are cut
  let droppedOperations = 0; // the oldest `droppedOperations` operations are cut
  let droppedInput = false;
  let droppedOutput = false;

  const candidate = (): DurableExecutionTelemetryRecord => {
    const out: DurableExecutionTelemetryRecord = {
      ...record,
      operations: ops.flatMap((op, i) => {
        if (rank[i] < droppedOperations) return [];
        if (resultRank[i] >= resultsDropped && !(clearSmall && small[i])) {
          return [op];
        }
        return [{ ...op, result: undefined, truncated: true }];
      }),
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

  const measure = (): number | undefined => jsonByteSize(render(candidate()));
  const fits = (): boolean => {
    const size = measure();
    return size !== undefined && size <= maxBytes;
  };

  // Sets the smallest count in lo..hi that fits, or hi if none fits. Returns
  // whether it fits. Binary search; see the doc comment for the assumption.
  const firstFit = (
    lo: number,
    hi: number,
    set: (n: number) => void,
  ): boolean => {
    let bad = lo - 1; // the largest count measured not to fit
    let good = hi + 1; // the smallest count measured to fit
    while (good - bad > 1) {
      const mid = (bad + good) >>> 1;
      set(mid);
      if (fits()) good = mid;
      else bad = mid;
    }
    set(Math.min(good, hi));
    return good <= hi;
  };

  // Phase 2: drop operation results, oldest first. The operation is kept and
  // marked `truncated` so consumers can tell its result was cut, not absent.
  // Dropping the causes alone can make the record fit. The search below does
  // not always measure that case, so it is measured first.
  const n = ops.length;
  const noneCleared = measure();
  const noneClearedFits = noneCleared !== undefined && noneCleared <= maxBytes;
  if (!noneClearedFits && small.includes(true)) {
    // A rendering that hides the per-operation `truncated` marker gets smaller
    // when a small result is cleared. Then skipping small results would drop
    // operations that clearing them saves. So measure once with every small
    // result cleared, and clear small results too if that record is smaller.
    clearSmall = true;
    const smallCleared = measure();
    clearSmall = false;
    if (
      noneCleared !== undefined &&
      smallCleared !== undefined &&
      smallCleared < noneCleared
    ) {
      rankResults(true);
    }
  }
  if (
    !noneClearedFits &&
    !firstFit(1, clearable, (c) => (resultsDropped = c))
  ) {
    // Phase 3: drop whole operations, oldest first.
    firstFit(1, n, (c) => (droppedOperations = c));
  }

  // Phase 4 (last resort): drop execution input, then output. Only reached once
  // every operation is gone and the record is still over the limit.
  if (!fits() && record.input !== undefined) droppedInput = true;
  if (!fits() && record.output !== undefined) droppedOutput = true;

  // If nothing was actually dropped, return the original untouched — not cut.
  if (
    !droppedCauses &&
    resultsDropped === 0 &&
    droppedOperations === 0 &&
    !droppedInput &&
    !droppedOutput
  ) {
    return record;
  }

  return candidate();
}
