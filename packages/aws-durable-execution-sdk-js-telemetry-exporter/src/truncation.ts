import type {
  ErrorRecord,
  OperationRecord,
  OperationSummary,
  DurableExecutionTelemetryRecord,
} from "./types";
import {
  applyOperationsFormat,
  buildOperationsByName,
} from "./operations-index";
import type { TruncationFormat } from "./truncation-internal";

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

interface JsonMetrics {
  bytes: number;
  quotes: number;
  backslashes: number;
}

function jsonMetrics(serialized: string): JsonMetrics {
  let quotes = 0;
  let backslashes = 0;
  for (const character of serialized) {
    if (character === '"') quotes++;
    else if (character === "\\") backslashes++;
  }
  return {
    bytes: encoder.encode(serialized).length,
    quotes,
    backslashes,
  };
}

function valueMetrics(value: unknown): JsonMetrics | undefined {
  try {
    const serializedValue = JSON.stringify(value);
    if (serializedValue === undefined) return undefined;
    return jsonMetrics(serializedValue);
  } catch {
    return undefined;
  }
}

function propertyMetrics(key: string, value: unknown): JsonMetrics | undefined {
  const serializedValue = valueMetrics(value);
  if (serializedValue === undefined) return undefined;
  const keyMetrics = jsonMetrics(JSON.stringify(key));
  return {
    bytes: keyMetrics.bytes + 1 + serializedValue.bytes,
    quotes: keyMetrics.quotes + serializedValue.quotes,
    backslashes: keyMetrics.backslashes + serializedValue.backslashes,
  };
}

function addMetrics(left: JsonMetrics, right: JsonMetrics): JsonMetrics {
  return {
    bytes: left.bytes + right.bytes,
    quotes: left.quotes + right.quotes,
    backslashes: left.backslashes + right.backslashes,
  };
}

function subtractMetrics(left: JsonMetrics, right: JsonMetrics): JsonMetrics {
  return {
    bytes: left.bytes - right.bytes,
    quotes: left.quotes - right.quotes,
    backslashes: left.backslashes - right.backslashes,
  };
}

function getOtelBody(value: unknown): { stringValue: string } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const resourceLogs = (value as { resourceLogs?: unknown }).resourceLogs;
  if (!Array.isArray(resourceLogs) || resourceLogs.length !== 1) {
    return undefined;
  }
  const scopeLogs = (resourceLogs[0] as { scopeLogs?: unknown })?.scopeLogs;
  if (!Array.isArray(scopeLogs) || scopeLogs.length !== 1) return undefined;
  const logRecords = (scopeLogs[0] as { logRecords?: unknown })?.logRecords;
  if (!Array.isArray(logRecords) || logRecords.length !== 1) return undefined;
  const body = (logRecords[0] as { body?: unknown })?.body;
  if (body === null || typeof body !== "object") return undefined;
  const stringValue = (body as { stringValue?: unknown }).stringValue;
  return typeof stringValue === "string"
    ? (body as { stringValue: string })
    : undefined;
}

function operationSummary(
  name: string,
  operation: OperationRecord | undefined,
): OperationSummary | undefined {
  if (operation === undefined) return undefined;
  const summaries = buildOperationsByName([operation]);
  return Object.hasOwn(summaries, name) ? summaries[name] : undefined;
}

function combineSummaries(
  left: OperationSummary | undefined,
  right: OperationSummary | undefined,
): OperationSummary | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const result: OperationSummary = {
    type: right.type,
    count: left.count + right.count,
    failedCount: left.failedCount + right.failedCount,
    status: right.status,
  };
  if (right.subType !== undefined) result.subType = right.subType;
  const minDurationMs = [left.minDurationMs, right.minDurationMs]
    .filter((value): value is number => value !== undefined)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  if (Number.isFinite(minDurationMs)) result.minDurationMs = minDurationMs;
  const maxDurationMs = [left.maxDurationMs, right.maxDurationMs]
    .filter((value): value is number => value !== undefined)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  if (Number.isFinite(maxDurationMs)) result.maxDurationMs = maxDurationMs;
  const totalDurationMs =
    (left.totalDurationMs ?? 0) + (right.totalDurationMs ?? 0);
  if (
    left.totalDurationMs !== undefined ||
    right.totalDurationMs !== undefined
  ) {
    result.totalDurationMs = totalDurationMs;
  }
  const maxAttempt = [left.maxAttempt, right.maxAttempt]
    .filter((value): value is number => value !== undefined)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  if (Number.isFinite(maxAttempt)) result.maxAttempt = maxAttempt;
  return result;
}

/** Segment tree keeps a repeated-name summary current in O(log n) per change. */
class OperationGroupTree {
  private readonly leafCount: number;
  private readonly nodes: (OperationSummary | undefined)[];

  constructor(
    private readonly name: string,
    indices: number[],
    operations: OperationRecord[],
  ) {
    this.leafCount = 2 ** Math.ceil(Math.log2(Math.max(1, indices.length)));
    this.nodes = new Array(this.leafCount * 2);
    indices.forEach((index, position) => {
      this.nodes[this.leafCount + position] = operationSummary(
        name,
        operations[index],
      );
    });
    for (let index = this.leafCount - 1; index > 0; index--) {
      this.nodes[index] = combineSummaries(
        this.nodes[index * 2],
        this.nodes[index * 2 + 1],
      );
    }
  }

  update(
    position: number,
    operation?: OperationRecord,
  ): OperationSummary | undefined {
    let index = this.leafCount + position;
    this.nodes[index] = operationSummary(this.name, operation);
    while (index > 1) {
      index = Math.floor(index / 2);
      this.nodes[index] = combineSummaries(
        this.nodes[index * 2],
        this.nodes[index * 2 + 1],
      );
    }
    return this.nodes[1];
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
  private readonly groups = new Map<string, OperationGroupTree>();
  private readonly positions = new Map<
    number,
    { name: string; position: number }
  >();
  private readonly summaries = new Map<string, OperationSummary>();
  private nestedMetrics: JsonMetrics | undefined;

  private constructor(
    initialSize: number,
    private readonly operations: OperationRecord[],
    private readonly kept: boolean[],
    private readonly hasArray: boolean,
    private readonly hasMap: boolean,
    private readonly format: TruncationFormat,
    private readonly originalMap: Record<string, OperationSummary> | undefined,
    nestedMetrics?: JsonMetrics,
  ) {
    this.size = initialSize;
    this.arrayCount = hasArray ? operations.length : 0;
    this.mapCount = originalMap ? Object.keys(originalMap).length : 0;
    this.nestedMetrics = nestedMetrics;
    const groupIndices = new Map<string, number[]>();
    operations.forEach((op, index) => {
      if (!op.name) return;
      const indices = groupIndices.get(op.name) ?? [];
      indices.push(index);
      groupIndices.set(op.name, indices);
    });
    for (const [name, indices] of groupIndices) {
      const tree = new OperationGroupTree(name, indices, operations);
      this.groups.set(name, tree);
      indices.forEach((index, position) => {
        this.positions.set(index, { name, position });
      });
    }
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
    format: TruncationFormat,
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

    let initialMap: Record<string, OperationSummary> | undefined;
    let nestedMetrics: JsonMetrics | undefined;
    if (format.envelope === "otel") {
      const body = getOtelBody(initialRendered);
      if (!body) return undefined;
      const bodyText = body.stringValue;
      let expected: string;
      try {
        expected = JSON.stringify(
          applyOperationsFormat(initialCandidate, format.operations),
        );
      } catch {
        return undefined;
      }
      if (bodyText !== expected) return undefined;
      const bodyMetrics = jsonMetrics(bodyText);
      body.stringValue = "";
      const outerSize = jsonByteSize(initialRendered);
      body.stringValue = bodyText;
      if (
        outerSize === undefined ||
        outerSize +
          bodyMetrics.bytes +
          bodyMetrics.quotes +
          bodyMetrics.backslashes !==
          initialSize
      ) {
        return undefined;
      }
      nestedMetrics = bodyMetrics;
      const expectedRecord = applyOperationsFormat(
        initialCandidate,
        format.operations,
      );
      if (format.operations === "by-name" || format.operations === "both") {
        initialMap = (
          expectedRecord as {
            operationsByName?: Record<string, OperationSummary>;
          }
        ).operationsByName;
      }
    } else {
      const expected = applyOperationsFormat(
        initialCandidate,
        format.operations,
      );
      try {
        if (JSON.stringify(initialRendered) !== JSON.stringify(expected)) {
          return undefined;
        }
      } catch {
        return undefined;
      }
      if (initialRendered === null || typeof initialRendered !== "object") {
        return undefined;
      }
      const rendered = initialRendered as Record<string, unknown>;
      if (format.operations === "array" || format.operations === "both") {
        if (!Array.isArray(rendered.operations)) return undefined;
      }
      initialMap =
        format.operations === "by-name" || format.operations === "both"
          ? (rendered.operationsByName as
              | Record<string, OperationSummary>
              | undefined)
          : undefined;
    }

    const hasArray =
      format.operations === "array" || format.operations === "both";
    const hasMap =
      format.operations === "by-name" || format.operations === "both";
    const map = initialMap;
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
      format,
      map as Record<string, OperationSummary> | undefined,
      nestedMetrics,
    );
  }

  get currentSize(): number {
    return this.size;
  }

  replace(
    index: number,
    previous: OperationRecord,
    next: OperationRecord,
  ): boolean {
    if (this.hasArray) {
      const before = valueMetrics(previous);
      const after = valueMetrics(next);
      if (before === undefined || after === undefined) return false;
      this.adjust(subtractMetrics(after, before));
    }
    if (this.hasMap && previous.name) {
      const position = this.positions.get(index);
      if (!position) return false;
      return this.updateGroup(position, next);
    }
    return true;
  }

  remove(index: number, operation: OperationRecord): boolean {
    if (this.hasArray) {
      const metrics = valueMetrics(operation);
      if (metrics === undefined) return false;
      if (this.arrayCount > 1) metrics.bytes++;
      this.adjust({
        bytes: -metrics.bytes,
        quotes: -metrics.quotes,
        backslashes: -metrics.backslashes,
      });
      this.arrayCount--;
    }
    if (this.hasMap && operation.name) {
      const position = this.positions.get(index);
      if (!position) return false;
      return this.updateGroup(position);
    }
    return true;
  }

  setDroppedOperations(previous: number, next: number): boolean {
    const before =
      previous > 0
        ? propertyMetrics("droppedOperations", previous)
        : { bytes: 0, quotes: 0, backslashes: 0 };
    const after =
      next > 0
        ? propertyMetrics("droppedOperations", next)
        : { bytes: 0, quotes: 0, backslashes: 0 };
    if (before === undefined || after === undefined) return false;
    let delta = subtractMetrics(after, before);
    if (previous === 0 && next > 0)
      delta = addMetrics(delta, { bytes: 1, quotes: 0, backslashes: 0 });
    this.adjust(delta);
    return true;
  }

  private updateGroup(
    position: { name: string; position: number },
    operation?: OperationRecord,
  ): boolean {
    const { name } = position;
    const oldSummary = this.summaries.get(name);
    const oldBytes =
      oldSummary === undefined
        ? { bytes: 0, quotes: 0, backslashes: 0 }
        : propertyMetrics(name, oldSummary);
    if (oldBytes === undefined) return false;
    const tree = this.groups.get(name);
    if (!tree) return false;
    const nextSummary = tree.update(position.position, operation);
    const nextBytes =
      nextSummary === undefined
        ? { bytes: 0, quotes: 0, backslashes: 0 }
        : propertyMetrics(name, nextSummary);
    if (nextBytes === undefined) return false;

    if (oldSummary === undefined && nextSummary !== undefined) {
      const delta = addMetrics(nextBytes, {
        bytes: this.mapCount > 0 ? 1 : 0,
        quotes: 0,
        backslashes: 0,
      });
      this.adjust(delta);
      this.mapCount++;
      this.summaries.set(name, nextSummary);
    } else if (oldSummary !== undefined && nextSummary === undefined) {
      const delta = addMetrics(oldBytes, {
        bytes: this.mapCount > 1 ? 1 : 0,
        quotes: 0,
        backslashes: 0,
      });
      this.adjust({
        bytes: -delta.bytes,
        quotes: -delta.quotes,
        backslashes: -delta.backslashes,
      });
      this.mapCount--;
      this.summaries.delete(name);
    } else if (oldSummary !== undefined && nextSummary !== undefined) {
      this.adjust(subtractMetrics(nextBytes, oldBytes));
      this.summaries.set(name, nextSummary);
    }
    return true;
  }

  private adjust(delta: JsonMetrics): void {
    this.size += delta.bytes;
    if (this.nestedMetrics) {
      this.size += delta.quotes + delta.backslashes;
      this.nestedMetrics = addMetrics(this.nestedMetrics, delta);
    }
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
    render === undefined ? { operations: "array" } : undefined,
  );
}

/** Internal fast path for SDK-owned renderers with a known operation shape. */
export function truncateRecordWithOperationsFormat(
  record: DurableExecutionTelemetryRecord,
  maxBytes: number | undefined,
  render: (r: DurableExecutionTelemetryRecord) => unknown,
  operationsFormat: TruncationFormat,
): DurableExecutionTelemetryRecord {
  return truncateRecordInternal(record, maxBytes, render, operationsFormat);
}

function truncateRecordInternal(
  record: DurableExecutionTelemetryRecord,
  maxBytes: number | undefined,
  render: (r: DurableExecutionTelemetryRecord) => unknown,
  operationsFormat: TruncationFormat | undefined,
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
  if (!fits()) {
    for (const idx of withResults) {
      const previous = ops[idx];
      ops[idx] = { ...previous, result: undefined, truncated: true };
      if (
        incrementalTracker &&
        !incrementalTracker.replace(idx, previous, ops[idx])
      ) {
        incrementalTracker = undefined;
      }
      anyResultDropped = true;
      // Preserve the documented first-fit behavior. A rendered format such as
      // `operationsByName` can grow when removing an occurrence restores the
      // surviving operation's result/error, so size is not monotonic.
      if (fits()) break;
    }
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
        (!incrementalTracker.remove(idx, operation) ||
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
