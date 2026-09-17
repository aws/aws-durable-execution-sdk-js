import type {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationInfo,
  InvocationEndInfo,
  OperationChangeInfo,
  OperationInfo,
  PluginInvocationStatus,
} from "@aws/durable-execution-sdk-js";
import type {
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  OperationOverride,
  OperationResult,
  JsonValue,
  InsightExporter,
} from "./types";
import { withOperationsByName } from "./operations-index";
import { truncateRecord } from "./truncation";

export type {
  InsightExporter,
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  OperationSummary,
  OperationsFormat,
  ContentConfig,
  OperationOverride,
} from "./types";

export {
  buildOperationsByName,
  withOperationsByName,
  applyOperationsFormat,
} from "./operations-index";

export { truncateRecord } from "./truncation";

export { S3Exporter } from "./exporters/s3-exporter";
export type { S3ExporterConfig } from "./exporters/s3-exporter";

export { DynamoDBExporter } from "./exporters/dynamodb-exporter";
export type { DynamoDBExporterConfig } from "./exporters/dynamodb-exporter";

export { AuroraExporter } from "./exporters/aurora-exporter";
export type { AuroraExporterConfig } from "./exporters/aurora-exporter";

export { CloudWatchLogsExporter } from "./exporters/cloudwatch-logs-exporter";
export type { CloudWatchLogsExporterConfig } from "./exporters/cloudwatch-logs-exporter";

export { OTelExporter } from "./exporters/otel-exporter";
export type { OTelExporterConfig } from "./exporters/otel-exporter";

export { FirehoseExporter } from "./exporters/firehose-exporter";
export type { FirehoseExporterConfig } from "./exporters/firehose-exporter";

export { EventBridgeExporter } from "./exporters/eventbridge-exporter";
export type { EventBridgeExporterConfig } from "./exporters/eventbridge-exporter";

export { RedshiftExporter } from "./exporters/redshift-exporter";
export type { RedshiftExporterConfig } from "./exporters/redshift-exporter";

export { OpenSearchExporter } from "./exporters/opensearch-exporter";
export type { OpenSearchExporterConfig } from "./exporters/opensearch-exporter";

export { SQSExporter } from "./exporters/sqs-exporter";
export type { SQSExporterConfig } from "./exporters/sqs-exporter";

export { HttpExporter } from "./exporters/http-exporter";
export type { HttpExporterConfig } from "./exporters/http-exporter";

export { FileExporter } from "./exporters/file-exporter";
export type { FileExporterConfig } from "./exporters/file-exporter";

// --- ARN Parsing ---

interface ParsedArn {
  functionName: string;
  qualifier: string;
  region: string;
  accountId: string;
  executionName: string;
  invocationId: string;
}

function parseExecutionArn(executionArn: string): ParsedArn {
  // Format: arn:<partition>:lambda:<region>:<accountId>:function:<functionName>:<qualifier>/durable-execution/<executionName>/<invocationId>
  const parts = executionArn.split(":");
  const lastPart = parts[7] ?? "";
  const segments = lastPart.split("/");
  return {
    region: parts[3] ?? "",
    accountId: parts[4] ?? "",
    functionName: parts[6] ?? "",
    qualifier: segments[0] ?? "",
    executionName: segments[2] ?? "",
    invocationId: segments[3] ?? "",
  };
}

// --- Sampling ---

/**
 * FNV-1a 32-bit hash. `Math.imul` performs a correct 32-bit integer multiply —
 * a plain `*` loses precision once the intermediate exceeds 2^53 — so the
 * result is identical across JS engines and therefore stable across replays.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic, all-or-nothing per-execution sampling decision.
 *
 * The execution ARN is stable across all invocations and replays of the same
 * execution, so hashing it directly yields a decision that never changes
 * mid-flight — a resumed execution always reaches the same conclusion. Maps the
 * hash into [0, 1) and samples in when it falls below `rate`.
 */
function shouldSampleExecution(executionArn: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return fnv1a32(executionArn) / 0xffffffff < rate;
}

/**
 * Normalizes a user-supplied `samplingRate` into a rate in [0, 1]. `undefined`
 * means "sample everything" (1.0). Out-of-range or non-numeric values are
 * clamped/defaulted with a warning rather than throwing, so a misconfiguration
 * never breaks instrumentation.
 */
function resolveSamplingRate(rate: number | undefined): number {
  if (rate === undefined) return 1;
  if (typeof rate !== "number" || Number.isNaN(rate)) {
    console.warn(
      "[workflow-insight] samplingRate is not a number; defaulting to 1.0 (all executions).",
    );
    return 1;
  }
  if (rate < 0 || rate > 1) {
    const clamped = Math.max(0, Math.min(1, rate));
    console.warn(
      `[workflow-insight] samplingRate ${rate} is out of range [0, 1]; clamping to ${clamped}.`,
    );
    return clamped;
  }
  return rate;
}

// --- Status Mapping ---

const STATUS_MAP: Record<string, WorkflowInsightRecord["status"]> = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  // A durable execution suspends (no compute) while waiting on a timer or an
  // external event/callback. The runtime reports this as PENDING, but from the
  // execution's point of view it is still in flight, so we surface it as
  // RUNNING. RETRYING (runtime will auto-retry) is likewise still in flight.
  PENDING: "RUNNING",
  RETRYING: "RUNNING",
};

function mapStatus(
  status: PluginInvocationStatus,
): WorkflowInsightRecord["status"] {
  return STATUS_MAP[status] ?? "RUNNING";
}

// --- Operation Records ---

/**
 * Operation timestamps may arrive as Date objects (local test runner) or as
 * epoch milliseconds / ISO strings (real Lambda durable runtime, after
 * checkpoint serialization). Normalize defensively so record building never
 * throws on an unexpected shape.
 *
 * An Invalid Date is treated as absent, exactly like an unparseable string: it
 * passes `instanceof Date`, so returning its `NaN` time would carry the failure
 * into `new Date(NaN).toISOString()`, which throws `RangeError` and loses the
 * whole record instead of one field. This matches the core SDK's own `toDate`
 * (`utils/timestamp/timestamp.ts`), which maps an unparseable wire timestamp to
 * `undefined` for the same reason.
 */
function toEpochMs(ts: unknown): number | undefined {
  if (ts == null) return undefined;
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : undefined;
  if (typeof ts === "string") {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function toIsoString(ts: unknown): string | undefined {
  const ms = toEpochMs(ts);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function toOperationRecord(op: OperationInfo): OperationRecord {
  const startMs = toEpochMs(op.startTimestamp);
  const endMs = toEpochMs(op.endTimestamp);
  const durationMs =
    startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined;

  return {
    id: op.id,
    name: op.name,
    type: op.type,
    subType: op.subType,
    parentId: op.parentId,
    status: op.status ?? "UNKNOWN",
    startTime: toIsoString(op.startTimestamp),
    endTime: toIsoString(op.endTimestamp),
    durationMs,
    attempt: op.attempt,
    error: op.error
      ? { name: op.error.name, message: op.error.message }
      : undefined,
  };
}

/**
 * Options controlling how operation records are filtered/enriched, derived from
 * `content.operations`.
 */
interface OperationContentOptions {
  /** Overrides keyed by `operationName`. */
  overridesByName: Map<string, OperationOverride>;
  /** Whether to include per-operation error details. */
  includeErrors: boolean;
  /**
   * When true, only top-level operations are emitted; any operation with a
   * `parentId` (parallel branches, map items, nested steps/contexts) is
   * dropped. Derived from `operationDetail: "top-level"`.
   */
  topLevelOnly: boolean;
}

/**
 * Applies a user-supplied result transform to an operation's raw (serialized)
 * result. The checkpointed result is a JSON string; we parse it before handing
 * it to the transform, falling back to the raw string if it isn't valid JSON.
 *
 * User transforms are untrusted code: a throwing transform must never break the
 * execution or leak the raw result, so on error we omit the field.
 */
function applyResultOverride(
  transform: (result: OperationResult) => OperationResult,
  rawResult: string | undefined,
): OperationResult | undefined {
  if (rawResult === undefined) return undefined;
  let parsed: OperationResult;
  try {
    parsed = JSON.parse(rawResult) as OperationResult;
  } catch {
    parsed = rawResult;
  }
  try {
    return transform(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Resolves a `content.input`/`content.output` setting against a value.
 * - `false` → omit (undefined)
 * - function → transformed value (omit on throw, so a failing redactor never
 *   leaks the raw value)
 * - `true`/`undefined` → include as-is
 */
function applyDataContent(
  value: unknown,
  setting: boolean | ((value: JsonValue) => JsonValue) | undefined,
): JsonValue | undefined {
  if (setting === false) return undefined;
  if (value === undefined) return undefined;
  if (typeof setting === "function") {
    try {
      return setting(value as JsonValue);
    } catch {
      return undefined;
    }
  }
  return value as JsonValue;
}

function buildOperationRecords(
  operations: Record<string, OperationInfo>,
  opts: OperationContentOptions,
): OperationRecord[] {
  const records: OperationRecord[] = [];
  for (const op of Object.values(operations)) {
    // The SDK core tracks the invocation/execution itself as a pseudo-entry
    // of type EXECUTION in its internal operations map (used for its own
    // ancestor-completion bookkeeping). It's not an operation a customer
    // created, its status is never transitioned past STARTED (that would
    // require rewriting core SDK internals unrelated to this plugin), and
    // the record already carries the execution's real status/startTime/
    // endTime/durationMs at the top level — so surfacing it as an "operation"
    // is redundant at best and misleadingly stuck-looking at worst. Exclude
    // it here rather than leaving it for exporters/consumers to filter.
    if (op.type === "EXECUTION") continue;

    // Unnamed operations are excluded by default (can't be targeted or keyed).
    if (!op.name) continue;

    // In "top-level" detail mode, drop anything nested under a context
    // (parallel branches, map items, nested steps/contexts). Top-level
    // operations have no parentId. This gives a resume-independent snapshot.
    if (opts.topLevelOnly && op.parentId) continue;

    const override = opts.overridesByName.get(op.name);
    if (override?.exclude) continue;

    const record = toOperationRecord(op);

    if (!opts.includeErrors) {
      record.error = undefined;
    }

    // Results are omitted unless an override explicitly opts in via a transform.
    if (override?.result) {
      record.result = applyResultOverride(override.result, op.result);
    }

    records.push(record);
  }
  return records;
}

// --- CloudWatch Logs Exporter ---

/**
 * Exports workflow insight records to CloudWatch Logs via console.log.
 * Since Lambda sends stdout to the function's CloudWatch log group,
 * this requires no additional IAM permissions or configuration.
 * @experimental This class is experimental and may change in future releases.
 */
export class LambdaLogExporter implements InsightExporter {
  /** CloudWatch Logs caps a single log event at 256 KB. */
  readonly maxRecordSizeBytes: number;

  constructor(config: { maxRecordSizeBytes?: number } = {}) {
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 256_000;
  }

  render = withOperationsByName;

  async export(record: WorkflowInsightRecord): Promise<void> {
    console.log(JSON.stringify(this.render(record)));
  }
}

// --- Per-Execution Scope ---

/**
 * One invocation's slot in the export queue.
 *
 * The scheduler outlives the invocations it serves (it belongs to the execution
 * environment, because serializing exporter calls is a cross-execution
 * concern), so it must not keep an index of its own from execution to queue
 * state: with Lambda Managed Instances several executions run concurrently in
 * one environment, and a scheduler-side map is exactly where one execution's
 * hooks could observe, overwrite, or wait on another's. Instead every scalar
 * the scheduler needs lives on the slot object it is handed, which is the
 * plugin instance the SDK built for that one invocation — so "which execution
 * is this?" is answered by object identity and has no second answer that could
 * disagree.
 */
interface ExportSlot {
  /**
   * Latest record scheduled for this execution and not yet handed to the
   * exporters. A newer snapshot of the same execution supersedes it.
   */
  pending: WorkflowInsightRecord | undefined;
  /** True while this slot sits in the scheduler's queue. */
  queued: boolean;
  /**
   * True while this slot has export work the scheduler has not finished:
   * queued, or dequeued and mid fan-out. It is what {@link ExportScheduler.drain}
   * tests to decide whether there is anything to wait for.
   */
  outstanding: boolean;
  /**
   * Resolvers waiting for this execution's latest record to be exported. A
   * non-empty list also tells the pump that this record gates an invocation
   * return, so it is exported before the pump spends a flush fan-out.
   */
  readonly waiters: (() => void)[];
}

// --- Export Scheduling ---

/**
 * Serializes record exports so that, at most, one export runs at a time, while
 * coalescing updates per execution.
 *
 * Each {@link WorkflowInsightRecord} is a complete snapshot of one execution,
 * so a newer record for that execution fully supersedes any record of the same
 * execution still waiting to be exported — intermediate records are dropped
 * because the latest one already contains all of their information. Coalescing
 * is therefore scoped to a single execution ARN: records for different
 * executions queue up independently and never displace one another.
 *
 * Exporter calls stay globally serialized per scheduler: one pump drains the
 * queue, so an exporter never sees concurrent `export()` calls from this
 * scheduler, no matter how many executions the environment hosts. {@link flush}
 * requests run on the same pump, so a flush never overlaps an export either;
 * they are served as a batch, and the records a {@link drain} is waiting for are
 * exported first, so a burst of invocation ends costs one flush rather than one
 * each. The scheduler therefore belongs to the execution environment, not to an
 * invocation: it lives in `workflowInsight`'s closure and is shared by every
 * plugin instance the factory hands out, because serializing exporter calls is
 * only meaningful across executions. Serialization is per scheduler, not per
 * exporter object: two `workflowInsight()` calls each build their own, so an
 * exporter instance shared between them can be called by both at once.
 */
class ExportScheduler {
  /** FIFO of slots that have a record waiting to be exported. */
  private readonly queue: ExportSlot[] = [];
  /**
   * True while a pump is running. A boolean rather than the pump's promise:
   * keeping the promise in a field means a pump that settles before the
   * assignment lands — which a synchronous failure does — has its own `finally`
   * clobbered by that assignment, leaving the marker armed forever and no later
   * `schedule` able to start a pump again.
   */
  private pumping = false;
  /**
   * Resolvers for pending {@link flush} requests, in request order. All requests
   * queued when the pump reaches its flush turn are served by one `flushAll`.
   */
  private readonly flushWaiters: (() => void)[] = [];

  constructor(private readonly exporters: InsightExporter[]) {}

  /**
   * Queue the latest record for one execution. If an export is already running,
   * the record waits in that execution's own pending slot (replacing only an
   * earlier record of the same execution) and is exported once the queue
   * reaches it.
   */
  schedule(slot: ExportSlot, record: WorkflowInsightRecord): void {
    slot.pending = record;
    slot.outstanding = true;
    if (!slot.queued) {
      slot.queued = true;
      this.queue.push(slot);
    }
    this.ensurePump();
  }

  /**
   * Starts the pump unless one is already running. Never throws, never rejects.
   */
  private ensurePump(): void {
    if (this.pumping) return;
    this.pumping = true;
    // The pump contains every failure it can encounter — allSettled around the
    // fan-out and the flush, `finally` around the bookkeeping — so this catch
    // only guards the unforeseen. Instrumentation must never hand the host
    // process an unhandled rejection, which node terminates on by default.
    // There is nothing to repair here: the pump's own `finally` has already
    // cleared `pumping` and re-armed itself if work was left behind.
    void this.pump().catch(() => undefined);
  }

  /**
   * Flush every exporter that supports it, serialized against exports: the
   * request is queued behind the pump's current fan-out, so an exporter never
   * sees `flush()` overlap an `export()`. Requests that are already waiting when
   * the pump reaches its flush turn are served by one shared `flushAll`.
   *
   * Before spending that fan-out the pump first exports the queued records a
   * {@link drain} is waiting for (see
   * {@link exportRecordsADrainIsWaitingFor}), which is what lets a burst of
   * invocation ends that each carry a record share one flush rather than pay for
   * one each. A request made while a flushAll is already running is never served
   * by it — it waits for the next turn.
   */
  async flush(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.flushWaiters.push(resolve);
      this.ensurePump();
    });
  }

  /**
   * Wait until the latest record scheduled for `slot` has been handed to every
   * exporter. Safe to call when that execution has nothing outstanding. Used
   * before an invocation returns to guarantee that execution's final record is
   * delivered (exports are otherwise fire-and-forget).
   *
   * Takes the slot itself, not an execution ARN: the caller is the plugin
   * instance that owns this invocation, so it *is* the slot its own hooks
   * schedule their records on and there is nothing to look up.
   *
   * Resolves as soon as this execution's own record is out, and never while it
   * is still pending. With a single pump the wait still includes whatever was
   * queued ahead of it; what it never does is let records scheduled afterwards,
   * for other executions, displace it or push it further back.
   *
   * While the wait is outstanding the slot carries a waiter, which is how the
   * pump knows this record gates an invocation return and must be exported
   * before the pump spends a flush fan-out — see
   * {@link exportRecordsADrainIsWaitingFor}.
   */
  async drain(slot: ExportSlot): Promise<void> {
    if (!slot.outstanding) return;
    await new Promise<void>((resolve) => {
      slot.waiters.push(resolve);
    });
  }

  private async pump(): Promise<void> {
    try {
      // One record, then one flush turn, alternating: a flush therefore
      // waits at most one fan-out — it cannot be starved by a queue that never
      // runs dry — and it still never overlaps an export, because each fan-out
      // is awaited before the flush runs and vice versa.
      while (this.queue.length > 0 || this.flushWaiters.length > 0) {
        const slot = this.queue.shift();
        if (slot !== undefined) {
          await this.exportPending(slot);
        }
        // Serve every request that is already waiting with one flushAll.
        // Coalescing is sound because each requester drained its own record
        // before asking: a flushAll that *starts* after the request was enqueued
        // therefore sees that record in the exporter's buffer and pushes it.
        // Requests that arrive while this flushAll runs are deliberately left
        // for the next turn — their record may have been exported after this
        // flush already read the buffer.
        const flushed = this.flushWaiters.splice(0);
        if (flushed.length > 0) {
          // Before spending the fan-out: export the queued records that other
          // invocations are still waiting on. Those ends cannot have asked for
          // their flush yet — they are inside drain() — so without this the pump
          // staggers them one record per turn with a whole flush in between, and
          // each end pays for its own flush however well the requests coalesce.
          await this.exportRecordsADrainIsWaitingFor();
          // Re-take: the ends released above ask for their flush as their
          // continuations run, and one flushAll covers all of them because it
          // starts after every one of those records reached the exporters. Still
          // taken strictly before the flush begins, so the rule above holds.
          flushed.push(...this.flushWaiters.splice(0));
          try {
            await flushAll(this.exporters);
          } finally {
            for (const resolve of flushed) resolve();
          }
        }
      }
    } finally {
      this.pumping = false;
      // A record or flush request that arrived while the loop was unwinding
      // must not be stranded. Re-arm on a fresh task rather than by calling
      // ensurePump() here: this `finally` can run synchronously inside
      // ensurePump() (a fan-out that throws before its first await never
      // suspends), and a direct call would then re-enter pump() on the current
      // stack, one frame pair per queued execution.
      if (this.queue.length > 0 || this.flushWaiters.length > 0) {
        queueMicrotask(() => this.ensurePump());
      }
    }
  }

  /**
   * Exports the queued records that a {@link drain} is waiting for, one at a
   * time, and returns once they have all reached the exporters. Called by the
   * pump immediately before a flush.
   *
   * Those records are the last records of invocations that cannot return until
   * they are exported, and their ends cannot ask for their flush until then.
   * Exporting them first is what lets one flush serve a whole burst of
   * invocation ends: without it the pump interleaves one record and one flush
   * fan-out, so each end pays for a flush of its own even though every queued
   * request is coalesced.
   *
   * Bounded by the snapshot taken in this synchronous turn, so a producer that
   * keeps scheduling records for an execution someone is draining cannot hold a
   * flush back indefinitely — and records nobody is waiting for (an on-change
   * stream, say) are not front-loaded at all, so they still cannot starve a
   * flush: it waits at most one ordinary fan-out plus this pass over the
   * executions whose invocation return is already blocked on their own record.
   */
  private async exportRecordsADrainIsWaitingFor(): Promise<void> {
    const awaited = this.queue.filter((slot) => slot.waiters.length > 0);
    for (const slot of awaited) {
      const index = this.queue.indexOf(slot);
      // Defensive: nothing else dequeues a slot while this pump owns the queue,
      // and a slot appears in it at most once (`queued` guards that), so the
      // snapshot entries are still queued here.
      if (index < 0) continue;
      this.queue.splice(index, 1);
      await this.exportPending(slot);
    }
  }

  /**
   * Hands one execution's queued record to every exporter and releases the
   * drains waiting on it. The caller has already removed `slot` from the queue.
   */
  private async exportPending(slot: ExportSlot): Promise<void> {
    slot.queued = false;
    const record = slot.pending;
    // Claim the record synchronously: from here on, anything scheduled for
    // this execution is a newer snapshot that re-queues the slot, so no
    // update is lost and no other execution can take this slot.
    slot.pending = undefined;
    try {
      if (record !== undefined) {
        // allSettled so one failing or slow exporter never blocks or
        // fails the others, and a `try` around the call so a *synchronous*
        // throw — from `export` itself, or from `truncateRecord`/`render`
        // — becomes a rejected promise that allSettled absorbs instead of
        // escaping the pump before its waiters are released.
        // `map(async (exporter) => ...)` would contain that throw too (an
        // async function turns a synchronous throw into a rejection) and
        // emits an identical record sequence under the real SDK driver —
        // the two forms only diverge under a driver that awaits the hook
        // directly. The explicit `catch` is kept because it keeps the
        // guard visible at the call site, instead of depending on the
        // reader knowing about that conversion. Nothing awaits the pump
        // and `drain` waits only on `settle`, so a broken exporter cannot
        // fail the invocation either. Each exporter gets a copy truncated
        // to its own maxRecordSizeBytes (no-op when unset), measured
        // against the exact shape that exporter emits (its `render`).
        await Promise.allSettled(
          this.exporters.map((exporter) => {
            try {
              return exporter.export(
                truncateRecord(
                  record,
                  exporter.maxRecordSizeBytes,
                  exporter.render?.bind(exporter),
                ),
              );
            } catch (error) {
              return Promise.reject(error);
            }
          }),
        );
      }
    } finally {
      // Release this execution's waiters even if the fan-out threw, and
      // only when nothing newer arrived for it while the fan-out ran;
      // otherwise they wait for that newer record.
      if (slot.pending === undefined) {
        this.settle(slot);
      }
    }
  }

  /** This execution has no outstanding record: wake anyone waiting on it. */
  private settle(slot: ExportSlot): void {
    slot.outstanding = false;
    for (const resolve of slot.waiters.splice(0)) {
      resolve();
    }
  }
}

/**
 * Start of the whole execution, resolved once per invocation from that
 * invocation's own info — the plugin instance never sees an earlier invocation
 * of the same execution, so there is nothing carried over to prefer.
 *
 * `executionStartTimestamp` is optional (the SDK fills it from
 * `initialExecutionEvent?.StartTimestamp ?? undefined`) but it always reaches the
 * plugin as a `Date`: the SDK normalizes every wire timestamp through
 * `utils/timestamp/timestamp.ts` `toDate` (via `normalize-operation.ts`, whose
 * output `with-durable-execution.ts:110` reads), and `toDate` maps an
 * unparseable or invalid value to `undefined` rather than passing on an Invalid
 * Date. {@link toEpochMs}'s ISO-string and epoch-millis branches are therefore
 * defensive only — a hand-built info object, a local driver, a future transport
 * change — not a transport this value actually crosses.
 *
 * The load-bearing part is the fallback: when the SDK reports nothing, use the
 * oldest operation start this invocation knows about rather than `new Date()`.
 * For a resumed execution that is still an earlier, replay-stable instant, where
 * `now` would report a duration covering only the final invocation.
 */
function resolveExecutionStart(info: {
  executionStartTimestamp?: Date;
  operations?: Record<string, OperationInfo>;
}): Date {
  const reported = toEpochMs(info.executionStartTimestamp);
  if (reported !== undefined) return new Date(reported);
  let oldest: number | undefined;
  for (const op of Object.values(info.operations ?? {})) {
    const started = toEpochMs(op.startTimestamp);
    if (started !== undefined && (oldest === undefined || started < oldest)) {
      oldest = started;
    }
  }
  return new Date(oldest ?? Date.now());
}

/**
 * Flush all exporters that support it, isolating individual failures: one
 * exporter's rejection never stops another's flush and never propagates into the
 * execution. Each failure is logged as a warning, so a flush that silently drops
 * buffered records is at least visible in the function's logs.
 */
async function flushAll(exporters: InsightExporter[]): Promise<void> {
  // The `try` mirrors the export fan-out's: an exporter whose `flush()` throws
  // synchronously instead of rejecting is absorbed by allSettled like any other
  // failure, rather than rejecting flushAll and stranding whoever waits on it.
  const results = await Promise.allSettled(
    exporters.map((exporter) => {
      try {
        return exporter.flush?.();
      } catch (error) {
        return Promise.reject(error);
      }
    }),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      // console.warn, not a throw: the flush contract is that failures never
      // reach the customer's execution.
      console.warn("[workflow-insight] exporter flush failed:", result.reason);
    }
  }
}

// --- Per-Invocation Plugin ---

/**
 * What {@link workflowInsight} resolves once for the execution environment and
 * hands, unchanged, to every plugin instance it creates: the exporters, the
 * scheduler that serializes them, and the immutable view of the user's config.
 *
 * These are the only things that legitimately outlive an invocation. Exporters
 * hold connections and buffers, and serializing their calls is a cross-execution
 * concern by definition, so the scheduler has to be shared; resolving the config
 * per invocation would just repeat the same work and re-log the same warnings.
 */
interface InsightEnvironment {
  readonly scheduler: ExportScheduler;
  readonly emitMode: NonNullable<WorkflowInsightConfig["emitMode"]>;
  readonly samplingRate: number;
  readonly content: WorkflowInsightConfig["content"];
  readonly opContentOptions: OperationContentOptions;
}

/**
 * The Workflow Insight plugin for exactly one durable execution invocation.
 *
 * The SDK builds one of these per invocation and drops it when the invocation
 * returns, so everything that belongs to the execution is an ordinary field:
 * there is no map from execution ARN to state, and therefore no way for one
 * execution's hook to read, overwrite, or wait on another's, and nothing to
 * remember to delete. Two executions running concurrently in one environment
 * (routine under Lambda Managed Instances) are two objects.
 *
 * Identity is taken from the {@link InvocationInfo} the factory receives, which
 * is the same object `onInvocationStart` is then called with, so the instance is
 * fully formed before the first hook fires — a hook that arrives without a
 * preceding `onInvocationStart` (the SDK's config-error path does exactly that)
 * still finds the ARN, sampling decision, start time and input in place.
 *
 * The instance is also its own {@link ExportSlot}: the scheduler is handed
 * `this`, so the queue entry and the object whose hooks fill it cannot get out
 * of step.
 */
class WorkflowInsightInvocation
  implements DurableInstrumentationPlugin, ExportSlot
{
  private readonly executionArn: string;
  private readonly parsedArn: ParsedArn;
  /** Start of the whole execution, not of this invocation. */
  private readonly startTime: Date;
  /**
   * The execution input, kept for the RUNNING records `onOperationChange`
   * builds — that hook is told only about operations. Released with the
   * instance when the invocation returns, so a suspended execution that never
   * resumes pins nothing.
   */
  private readonly cachedInput: unknown;
  /**
   * Deterministic sampling decision for this execution. Computed from the
   * execution's stable identity, so every invocation and replay of it reaches
   * the same conclusion, and read by every hook to skip work entirely when the
   * execution is sampled out.
   */
  private readonly sampledIn: boolean;
  /**
   * Set once this invocation has ended. A late hook still lands on this same
   * instance — the SDK does not order `onOperationChange` against
   * `onInvocationEnd`, so a checkpoint that completed just before the end can
   * deliver its change afterwards — and it must emit nothing: exporters that
   * upsert by execution ARN would otherwise revert a finished execution back to
   * RUNNING.
   */
  private closed = false;

  // --- ExportSlot; owned by ExportScheduler ---
  pending: WorkflowInsightRecord | undefined = undefined;
  queued = false;
  outstanding = false;
  readonly waiters: (() => void)[] = [];

  constructor(
    private readonly env: InsightEnvironment,
    info: InvocationInfo,
  ) {
    this.executionArn = info.executionArn;
    this.parsedArn = parseExecutionArn(info.executionArn);
    this.startTime = resolveExecutionStart(info);
    this.cachedInput = info.executionInput;
    this.sampledIn = shouldSampleExecution(info.executionArn, env.samplingRate);
  }

  private buildRecord(args: {
    status: WorkflowInsightRecord["status"];
    operations: OperationRecord[];
    endTime?: Date;
    input?: unknown;
    output?: unknown;
    error?: Error;
  }): WorkflowInsightRecord {
    const arn = this.parsedArn;
    const content = this.env.content;
    const durationMs = args.endTime
      ? args.endTime.getTime() - this.startTime.getTime()
      : undefined;

    return {
      recordType: "WorkflowInsight" as const,
      schemaVersion: "1.0",
      emittedAt: new Date().toISOString(),
      executionArn: this.executionArn,
      executionName: arn.executionName || undefined,
      functionName: arn.functionName,
      functionQualifier: arn.qualifier,
      region: arn.region,
      accountId: arn.accountId,
      status: args.status,
      startTime: this.startTime.toISOString(),
      endTime: args.endTime?.toISOString(),
      durationMs,
      input: applyDataContent(args.input, content?.input),
      output: applyDataContent(args.output, content?.output),
      error: args.error
        ? { name: args.error.name, message: args.error.message }
        : undefined,
      operations: args.operations,
    };
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    if (!this.sampledIn) return;

    if (this.env.emitMode === "on-change") {
      this.env.scheduler.schedule(
        this,
        this.buildRecord({
          status: "RUNNING",
          operations: buildOperationRecords(
            info.operations,
            this.env.opContentOptions,
          ),
          input: info.executionInput,
        }),
      );
    }
  }

  /**
   * Emits this invocation's final record and does not resolve until it has
   * reached every exporter.
   *
   * The SDK awaits this hook on every path out of an invocation — the six
   * status branches in `with-durable-execution.ts` plus the config-error path
   * that returns before `wrapInvocation` is ever called — and the runner awaits
   * it through `Promise.allSettled`, so the wait is guaranteed to complete
   * before the Lambda response is returned and a rejection here cannot become
   * the invocation's error. That makes this the right place for the drain, and
   * it is where the Python and Java ports already do it.
   */
  async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
    const status = mapStatus(info.status);
    const isTerminal = status === "SUCCEEDED" || status === "FAILED";
    const isFailure = status === "FAILED";

    // Decide whether this status update should produce a record.
    // - on-change:   emit on every update (terminal or not)
    // - on-complete: emit only on terminal SUCCEEDED/FAILED
    // - on-failure:  emit only on terminal FAILED
    const shouldEmit =
      this.env.emitMode === "on-change"
        ? true
        : this.env.emitMode === "on-failure"
          ? isFailure
          : isTerminal;

    // This invocation is over: a hook that still arrives is late and must emit
    // nothing, or an exporter that upserts by execution ARN would revert the
    // state we are about to write.
    this.closed = true;

    // The drain is in a `finally` so it also covers the paths that never reach
    // the schedule above: a sampled-in end that emits nothing in this mode may
    // still have a record queued by an earlier hook, and a throw while building
    // the record (a poisoned `error.message`, say) must not strand whatever was
    // already queued.
    try {
      if (this.sampledIn && shouldEmit) {
        this.env.scheduler.schedule(
          this,
          this.buildRecord({
            status,
            operations: buildOperationRecords(
              info.operations,
              this.env.opContentOptions,
            ),
            endTime: new Date(),
            input: info.executionInput,
            output: info.executionResult,
            error: info.executionError,
          }),
        );
      }
    } finally {
      // Sampled-out executions never schedule a record, so there is nothing to
      // drain or flush — skip the work entirely. The flush goes through the
      // scheduler so it is serialized against exports: an exporter never sees
      // one execution's flush() overlap another's export().
      if (this.sampledIn) {
        await this.env.scheduler.drain(this);
        await this.env.scheduler.flush();
      }
    }
  }

  async onOperationChange(info: OperationChangeInfo): Promise<void> {
    if (this.env.emitMode !== "on-change") return;
    // `closed` is the whole guard: this hook can arrive after the end hook, and
    // emitting then would publish RUNNING after the terminal record. It no
    // longer has to check that the change belongs to this execution — a hook
    // reaches this instance only if it does.
    if (this.closed || !this.sampledIn) return;
    this.env.scheduler.schedule(
      this,
      this.buildRecord({
        status: "RUNNING",
        operations: buildOperationRecords(
          info.operations,
          this.env.opContentOptions,
        ),
        input: this.cachedInput,
      }),
    );
  }
}

// --- Plugin Factory ---

/**
 * Creates the Workflow Insight plugin factory the SDK installs.
 *
 * Call it once, at module scope, and pass the result in
 * `DurableExecutionConfig.plugins`. The SDK then calls the returned factory
 * once per invocation and dispatches that invocation's hooks to the instance it
 * returns, so config resolution, the exporters and the export scheduler are
 * shared by the whole execution environment while every execution's own state
 * is confined to an object that dies with its invocation.
 *
 * @experimental This function is experimental and may change in future releases.
 */
export function workflowInsight(
  config: WorkflowInsightConfig,
): DurableInstrumentationPluginFactory {
  const content = config.content;
  const overridesByName = new Map<string, OperationOverride>();
  for (const override of content?.operations?.overrides ?? []) {
    overridesByName.set(override.operationName, override);
  }

  // `exporters` reaches `this.exporters.map` inside the pump's guarded region,
  // which is the fan-out's last remaining synchronous-throw site: an array-like
  // passes a truthiness/`.length` check and then makes every fan-out throw a
  // TypeError. Require a real array and fall back to the default exporter.
  if (config.exporters !== undefined && !Array.isArray(config.exporters)) {
    console.warn(
      "[workflow-insight] exporters is not an array; defaulting to the Lambda log exporter.",
    );
  }
  const exporters =
    Array.isArray(config.exporters) && config.exporters.length > 0
      ? config.exporters
      : [new LambdaLogExporter()];

  const env: InsightEnvironment = {
    scheduler: new ExportScheduler(exporters),
    emitMode: config.emitMode ?? "on-complete",
    samplingRate: resolveSamplingRate(config.samplingRate),
    content,
    opContentOptions: {
      overridesByName,
      includeErrors: content?.operations?.includeErrors ?? true,
      // Default to top-level: it yields a consistent snapshot regardless of
      // suspend/resume. "full-tree" is opt-in because, without child
      // preservation (pluginsConfig.childOperationsDepth), it can silently miss
      // children of contexts that finished in an earlier invocation.
      topLevelOnly: config.operationDetail !== "full-tree",
    },
  };

  return (info: InvocationInfo) => new WorkflowInsightInvocation(env, info);
}
