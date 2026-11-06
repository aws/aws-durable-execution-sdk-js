import type {
  ErrorRecord,
  OperationRecord,
  OperationSummary,
  OperationsFormat,
  DurableExecutionTelemetryRecord,
} from "./types";
import {
  applyOperationsFormat,
  buildOperationsByName,
} from "./operations-index";
import type { TruncationOperationsFormat } from "./truncation-internal";

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

function propertyByteSize(key: string, value: unknown): number | undefined {
  try {
    const serializedValue = JSON.stringify(value);
    if (serializedValue === undefined) return undefined;
    return encoder.encode(`${JSON.stringify(key)}:${serializedValue}`).length;
  } catch {
    return undefined;
  }
}

/**
 * Tracks exact JSON byte deltas for SDK-owned operation render shapes. Only the
 * operation array and its name-index projection change during phases 2 and 3;
 * the rest of the rendered record is measured once.
 */
class IncrementalSizeTracker {
  private size: number;
  private arrayCount: number;
  private mapCount: number;
  private readonly groupIndices = new Map<string, number[]>();
  private readonly summaries = new Map<string, OperationSummary>();

  private constructor(
    initialSize: number,
    private readonly operations: OperationRecord[],
    private readonly kept: boolean[],
    private readonly hasArray: boolean,
    private readonly hasMap: boolean,
    private readonly originalMap: Record<string, OperationSummary> | undefined,
  ) {
    this.size = initialSize;
    this.arrayCount = hasArray ? operations.length : 0;
    this.mapCount = originalMap ? Object.keys(originalMap).length : 0;
    operations.forEach((op, index) => {
      if (!op.name) return;
      const indices = this.groupIndices.get(op.name) ?? [];
      indices.push(index);
      this.groupIndices.set(op.name, indices);
    });
    if (hasMap && originalMap) {
      for (const [name, summary] of Object.entries(originalMap)) {
        this.summaries.set(name, summary);
      }
    }
  }

  static create(
    render: (r: DurableExecutionTelemetryRecord) => unknown,
    candidate: () => DurableExecutionTelemetryRecord,
    operations: OperationRecord[],
    kept: boolean[],
    format: OperationsFormat | "by-name",
  ): IncrementalSizeTracker | undefined {
    const initialCandidate = candidate();
    const initialRendered = render(initialCandidate);
    const initialSize = jsonByteSize(initialRendered);
    if (
      initialSize === undefined ||
      initialRendered === null ||
      typeof initialRendered !== "object" ||
      Array.isArray(initialRendered)
    ) {
      return undefined;
    }

    const expected = applyOperationsFormat(initialCandidate, format);
    try {
      if (JSON.stringify(initialRendered) !== JSON.stringify(expected)) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const rendered = initialRendered as Record<string, unknown>;
    const hasArray = format === "array" || format === "both";
    const hasMap = format === "by-name" || format === "both";
    if (hasArray && !Array.isArray(rendered.operations)) return undefined;
    const map = hasMap ? rendered.operationsByName : undefined;
    if (
      hasMap &&
      (map === null || typeof map !== "object" || Array.isArray(map))
    ) {
      return undefined;
    }

    // Ensure the candidate is currently over the limit; `truncateRecord` only
    // initializes this after its original-record size check has failed.
    if (initialSize <= 0 || initialCandidate.droppedOperations !== undefined) {
      return undefined;
    }
    return new IncrementalSizeTracker(
      initialSize,
      operations,
      kept,
      hasArray,
      hasMap,
      map as Record<string, OperationSummary> | undefined,
    );
  }

  get currentSize(): number {
    return this.size;
  }

  replace(previous: OperationRecord, next: OperationRecord): boolean {
    if (this.hasArray) {
      const before = jsonByteSize(previous);
      const after = jsonByteSize(next);
      if (before === undefined || after === undefined) return false;
      this.size += after - before;
    }
    if (this.hasMap && previous.name) {
      return this.updateGroup(previous.name);
    }
    return true;
  }

  remove(operation: OperationRecord): boolean {
    if (this.hasArray) {
      const bytes = jsonByteSize(operation);
      if (bytes === undefined) return false;
      this.size -= bytes + (this.arrayCount > 1 ? 1 : 0);
      this.arrayCount--;
    }
    if (this.hasMap && operation.name) {
      return this.updateGroup(operation.name);
    }
    return true;
  }

  setDroppedOperations(previous: number, next: number): boolean {
    const before =
      previous > 0 ? propertyByteSize("droppedOperations", previous) : 0;
    const after = next > 0 ? propertyByteSize("droppedOperations", next) : 0;
    if (before === undefined || after === undefined) return false;
    if (previous === 0 && next > 0) this.size += after + 1;
    else this.size += after - before;
    return true;
  }

  private updateGroup(name: string): boolean {
    const oldSummary = this.summaries.get(name);
    const oldBytes =
      oldSummary === undefined ? 0 : propertyByteSize(name, oldSummary);
    if (oldBytes === undefined) return false;

    const members = (this.groupIndices.get(name) ?? [])
      .filter((index) => this.kept[index])
      .map((index) => this.operations[index]);
    const nextSummary = buildOperationsByName(members)[name];
    const nextBytes =
      nextSummary === undefined ? 0 : propertyByteSize(name, nextSummary);
    if (nextBytes === undefined) return false;

    if (oldSummary === undefined && nextSummary !== undefined) {
      this.size += nextBytes + (this.mapCount > 0 ? 1 : 0);
      this.mapCount++;
      this.summaries.set(name, nextSummary);
    } else if (oldSummary !== undefined && nextSummary === undefined) {
      this.size -= oldBytes + (this.mapCount > 1 ? 1 : 0);
      this.mapCount--;
      this.summaries.delete(name);
    } else if (oldSummary !== undefined && nextSummary !== undefined) {
      this.size += nextBytes - oldBytes;
      this.summaries.set(name, nextSummary);
    }
    return true;
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
  render?: (r: DurableExecutionTelemetryRecord) => unknown,
): DurableExecutionTelemetryRecord {
  return truncateRecordInternal(
    record,
    maxBytes,
    render ?? ((r) => r),
    render === undefined ? "array" : undefined,
  );
}

/** Internal fast path for SDK-owned renderers with a known operation shape. */
export function truncateRecordWithOperationsFormat(
  record: DurableExecutionTelemetryRecord,
  maxBytes: number | undefined,
  render: (r: DurableExecutionTelemetryRecord) => unknown,
  operationsFormat: TruncationOperationsFormat,
): DurableExecutionTelemetryRecord {
  return truncateRecordInternal(record, maxBytes, render, operationsFormat);
}

function truncateRecordInternal(
  record: DurableExecutionTelemetryRecord,
  maxBytes: number | undefined,
  render: (r: DurableExecutionTelemetryRecord) => unknown,
  operationsFormat: TruncationOperationsFormat | undefined,
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

  let incrementalTracker: IncrementalSizeTracker | undefined;
  let trackerInitialized = false;
  const fitsFull = (): boolean => {
    const size = jsonByteSize(render(candidate()));
    return size !== undefined && size <= maxBytes;
  };
  const fits = (): boolean => {
    if (operationsFormat !== undefined && !trackerInitialized) {
      trackerInitialized = true;
      incrementalTracker = IncrementalSizeTracker.create(
        render,
        candidate,
        ops,
        kept,
        operationsFormat,
      );
    }
    return incrementalTracker
      ? incrementalTracker.currentSize <= maxBytes
      : fitsFull();
  };

  // Phase 2: drop operation results, oldest first. The operation is kept and
  // marked `truncated` so consumers can tell its result was cut, not absent.
  const withResults = order.filter((idx) => ops[idx].result !== undefined);
  for (const idx of withResults) {
    const previous = ops[idx];
    ops[idx] = { ...previous, result: undefined, truncated: true };
    if (incrementalTracker && !incrementalTracker.replace(previous, ops[idx])) {
      incrementalTracker = undefined;
    }
    anyResultDropped = true;
    // Preserve the documented first-fit behavior. A rendered format such as
    // `operationsByName` can grow when removing an occurrence restores the
    // surviving operation's result/error, so size is not monotonic.
    if (fits()) break;
  }

  // Phase 3: drop whole operations, oldest first.
  if (!fits()) {
    for (const idx of order) {
      const previousDroppedOperations = droppedOperations;
      const operation = ops[idx];
      kept[idx] = false;
      droppedOperations++;
      if (
        incrementalTracker &&
        (!incrementalTracker.remove(operation) ||
          !incrementalTracker.setDroppedOperations(
            previousDroppedOperations,
            droppedOperations,
          ))
      ) {
        incrementalTracker = undefined;
      }
      if (fits()) break;
    }
  }

  // Phase 4 (last resort): drop execution input, then output. Only reached once
  // every operation is gone and the record is still over the limit.
  if (!fitsFull() && record.input !== undefined) droppedInput = true;
  if (!fitsFull() && record.output !== undefined) droppedOutput = true;

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
