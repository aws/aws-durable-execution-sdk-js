/**
 * Durable executions read straight from the Lambda API, with no exporter in
 * between.
 *
 * Everything else in this package reads what the telemetry exporter wrote to a
 * destination. This module is the other source: the durable-execution APIs
 * Lambda itself serves (`GetDurableExecution`, `GetDurableExecutionHistory`).
 * It works for any durable function, whether or not it runs the telemetry
 * plugin, and it is what the execution viewer is built on. It only reads.
 *
 * Host-free like the rest of core: no `vscode`, `electron`, or MCP import.
 */
import {
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  LambdaClient,
  type ErrorObject,
  type Event as HistoryApiEvent,
} from "@aws-sdk/client-lambda";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

/** The subset of LambdaClient this module calls; tests pass a fake. */
export interface LambdaSender {
  // biome-ignore lint/suspicious/noExplicitAny: commands are heterogeneous; each call site narrows the output.
  send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any>;
}

export interface LambdaContext {
  /**
   * The default region, for calls that do not name one. `getExecution` uses
   * the region in the execution ARN instead.
   */
  region: string;
  credentials: AwsCredentialIdentityProvider;
  /**
   * Builds the client for a region. Defaults to a real {@link LambdaClient}.
   * The region is passed because an execution ARN names its own region, which
   * can differ from the configured one.
   */
  clientFor?: (region: string) => LambdaSender;
}

/** One event in a durable execution's history, flattened for display. */
export interface HistoryEvent {
  eventId?: number;
  type?: string;
  subType?: string;
  name?: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
}

/**
 * An operation aggregated from its history events (start + terminal), forming
 * a tree via {@link OperationNode.children} (map → iterations → steps, etc.).
 */
export interface OperationNode {
  id: string;
  parentId?: string;
  name?: string;
  /** Operation kind: the event's SubType when present, else Step/Wait/Context/…. */
  kind?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  /** How many times the operation started: 2 after one retry. */
  attempt?: number;
  /**
   * When status is PENDING: when the next attempt is due. A failed attempt
   * that will be retried is PENDING, not FAILED; its `error` is the error of
   * that last attempt.
   */
  nextAttemptTime?: string;
  /** Serialized result payload, as checkpointed. */
  result?: string;
  /** True when the service truncated the result or error payload. */
  payloadTruncated?: boolean;
  /** Pretty-printed error object. */
  error?: string;
  /** Wait operations: when the wait is scheduled to end. */
  scheduledEndTime?: string;
  /** Callback operations: the callback id a caller completes. */
  callbackId?: string;
  /** Chained invokes: the function invoked and its execution, when known. */
  invokedFunction?: string;
  invokedExecutionArn?: string;
  children?: OperationNode[];
}

/** One Lambda invocation that served the execution (an InvocationCompleted event). */
export interface InvocationRow {
  requestId?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  error?: string;
}

export interface ExecutionDetail {
  arn: string;
  name?: string;
  functionArn?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  version?: string;
  input?: string;
  result?: string;
  error?: string;
  history: HistoryEvent[];
  operations: OperationNode[];
  invocations: InvocationRow[];
  /**
   * Set when a history call failed. The summary is still valid. `history`,
   * `operations` and `invocations` are then empty, because a partial history
   * would show finished operations as open.
   */
  historyError?: string;
}

/** Execution statuses after which nothing changes. */
export const TERMINAL_EXECUTION_STATUSES: readonly string[] = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "STOPPED",
];

/** The largest page that GetDurableExecutionHistory returns. */
const HISTORY_PAGE_SIZE = 1000;
const MAX_EXECUTION_ARN_LENGTH = 2048;
const EXECUTION_MARKER = "/durable-execution/";

/** Whether `s` has the shape of an AWS region name, such as `eu-west-1`. */
function isRegionLike(s: string): boolean {
  if (s.length === 0 || s.length > 32) return false;
  for (const c of s) {
    if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-")) {
      return false;
    }
  }
  return true;
}

function isDigits(s: string, length: number): boolean {
  if (s.length !== length) return false;
  for (const c of s) if (c < "0" || c > "9") return false;
  return true;
}

/**
 * Parses an execution ARN of the form
 * `arn:<partition>:lambda:<region>:<account>:function:<name>[:<qualifier>]/durable-execution/<name>/<id>`
 * (partition `aws`, `aws-cn`, `aws-us-gov`, …). Returns its region, or
 * undefined when `value` is not one. Plain string checks rather than a regex,
 * so there is no backtracking to reason about on hostile input.
 */
function parseExecutionArn(value: unknown): { region: string } | undefined {
  if (typeof value !== "string" || value.length > MAX_EXECUTION_ARN_LENGTH) {
    return undefined;
  }
  const at = value.indexOf(EXECUTION_MARKER);
  if (at < 0 || at + EXECUTION_MARKER.length === value.length) return undefined;
  const parts = value.slice(0, at).split(":");
  if (parts.length !== 7 && parts.length !== 8) return undefined;
  const [arn, partition, service, region, account, resource, name] = parts;
  if (
    arn !== "arn" ||
    !(partition === "aws" || partition.startsWith("aws-")) ||
    service !== "lambda" ||
    !isRegionLike(region) ||
    !isDigits(account, 12) ||
    resource !== "function" ||
    name.length === 0
  ) {
    return undefined;
  }
  return { region };
}

/**
 * Whether `value` has the shape of a durable execution ARN. `getExecution`
 * rejects anything else before it calls the Lambda API.
 */
export function isDurableExecutionArn(value: unknown): value is string {
  return parseExecutionArn(value) !== undefined;
}

/** The region an execution ARN names, or undefined when it is not one. */
export function regionFromExecutionArn(arn: string): string | undefined {
  return parseExecutionArn(arn)?.region;
}

function clientFor(ctx: LambdaContext, region = ctx.region): LambdaSender {
  return ctx.clientFor
    ? ctx.clientFor(region)
    : new LambdaClient({ region, credentials: ctx.credentials });
}

function durationBetween(start?: Date, end?: Date): number | undefined {
  return start && end ? end.getTime() - start.getTime() : undefined;
}

/**
 * Fetches one durable execution: its summary from GetDurableExecution, plus its
 * whole history, folded into an operation tree.
 *
 * The whole history is read, because a partial one shows finished operations
 * as open. Lambda bounds its size: at most 30,000 operations and 100 MB of
 * persisted payload per execution. The client targets the region named in the
 * ARN, so a link from a telemetry record in another region still resolves.
 *
 * A history failure does not fail the call: the summary is still useful, and
 * the failure is reported as `historyError` rather than hidden.
 */
export async function getExecution(
  ctx: LambdaContext,
  arn: string,
): Promise<ExecutionDetail> {
  if (!isDurableExecutionArn(arn)) {
    throw new Error(`Not a durable execution ARN: ${arn}`);
  }
  const lambda = clientFor(ctx, regionFromExecutionArn(arn));
  const e = await lambda.send(
    new GetDurableExecutionCommand({ DurableExecutionArn: arn }),
  );

  let raw: HistoryApiEvent[] = [];
  let historyError: string | undefined;
  try {
    let marker: string | undefined;
    do {
      const page = await lambda.send(
        new GetDurableExecutionHistoryCommand({
          DurableExecutionArn: arn,
          IncludeExecutionData: true,
          MaxItems: HISTORY_PAGE_SIZE,
          Marker: marker,
        }),
      );
      raw.push(...(page.Events ?? []));
      marker = page.NextMarker;
    } while (marker);
  } catch (err) {
    historyError = err instanceof Error ? err.message : String(err);
    raw = [];
  }

  // The summary is read before the history. So the execution can end in
  // between, and then the summary still says it is running while the history
  // holds its end. The history is newer, so its end wins.
  const summaryStatus = e.Status ?? "";
  const end = TERMINAL_EXECUTION_STATUSES.includes(summaryStatus)
    ? undefined
    : executionEndOf(raw);
  const endTimestamp: Date | undefined = end?.at ?? e.EndTimestamp;
  return {
    arn,
    name: e.DurableExecutionName ?? undefined,
    functionArn: e.FunctionArn ?? undefined,
    status: end?.status ?? summaryStatus,
    startTime: e.StartTimestamp?.toISOString(),
    endTime: endTimestamp?.toISOString(),
    durationMs: durationBetween(e.StartTimestamp, endTimestamp),
    version: e.Version ?? undefined,
    input: e.InputPayload ?? undefined,
    result: e.Result ?? end?.result,
    error: e.Error ? formatError(e.Error) : end?.error,
    history: raw.map(toHistoryEvent),
    operations: buildOperations(raw, {
      executionEnded: TERMINAL_EXECUTION_STATUSES.includes(summaryStatus),
    }),
    invocations: buildInvocations(raw),
    ...(historyError ? { historyError } : {}),
  };
}

/**
 * The execution's end as the history records it: the last terminal
 * `Execution*` event, with its status, time, result, and error.
 */
function executionEndOf(
  events: HistoryApiEvent[],
): { status: string; at?: Date; result?: string; error?: string } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const type = ev.EventType ?? "";
    const status = type.startsWith("Execution")
      ? terminalStatus(type)
      : undefined;
    if (!status) continue;
    const details = detailsOf(ev);
    return {
      status,
      at: ev.EventTimestamp,
      result: details?.Result?.Payload,
      error: details?.Error?.Payload
        ? formatError(details.Error.Payload)
        : undefined,
    };
  }
  return undefined;
}

/**
 * When the next attempt is due, from an event's time and its
 * `NextAttemptDelaySeconds`. Undefined when the delay is not a finite number
 * or the time it gives is not a valid date, including when `ts` is missing. Lambda writes the history, but a
 * malformed value must not fail the whole page.
 */
function nextAttemptAt(
  ts: string | undefined,
  delay: unknown,
): string | undefined {
  if (
    ts === undefined ||
    typeof delay !== "number" ||
    !Number.isFinite(delay)
  ) {
    return undefined;
  }
  const at = new Date(new Date(ts).getTime() + delay * 1000);
  return Number.isFinite(at.getTime()) ? at.toISOString() : undefined;
}

function toHistoryEvent(ev: HistoryApiEvent): HistoryEvent {
  return {
    eventId: ev.EventId,
    type: ev.EventType,
    subType: ev.SubType,
    name: ev.Name,
    id: ev.Id,
    parentId: ev.ParentId,
    timestamp: ev.EventTimestamp?.toISOString(),
  };
}

/** Pretty-prints an ErrorObject with stable, readable keys. */
export function formatError(err: ErrorObject): string {
  const out: Record<string, unknown> = {};
  if (err.ErrorType) out.errorType = err.ErrorType;
  if (err.ErrorMessage) out.errorMessage = err.ErrorMessage;
  if (err.ErrorData) out.errorData = err.ErrorData;
  if (err.StackTrace?.length) out.stackTrace = err.StackTrace;
  return JSON.stringify(out, null, 2);
}

const TERMINAL_SUFFIXES: ReadonlyArray<[string, string]> = [
  ["Succeeded", "SUCCEEDED"],
  ["Failed", "FAILED"],
  ["TimedOut", "TIMED_OUT"],
  ["Stopped", "STOPPED"],
  ["Cancelled", "CANCELLED"],
];

function terminalStatus(type: string): string | undefined {
  for (const [suffix, status] of TERMINAL_SUFFIXES) {
    if (type.endsWith(suffix)) return status;
  }
  return undefined;
}

function kindOf(type: string, subType?: string): string {
  if (subType) return subType;
  return type.replace(
    /(Started|Succeeded|Failed|TimedOut|Stopped|Cancelled)$/,
    "",
  );
}

interface DetailFields {
  Result?: { Payload?: string; Truncated?: boolean };
  Error?: { Payload?: ErrorObject; Truncated?: boolean };
  RetryDetails?: { NextAttemptDelaySeconds?: number };
  ScheduledEndTimestamp?: Date;
  CallbackId?: string;
  FunctionName?: string;
  DurableExecutionArn?: string;
}

/** The `<EventType>Details` object an event carries, if any. */
function detailsOf(ev: HistoryApiEvent): DetailFields | undefined {
  const type = ev.EventType;
  if (!type) return undefined;
  return (ev as Record<string, unknown>)[`${type}Details`] as
    | DetailFields
    | undefined;
}

/**
 * Folds history events into a forest of operations. Events sharing an `Id` are
 * one operation: a `*Started` event opens it (and re-opens it on a retry), a
 * terminal event closes it with its status, result, and error. `ParentId`
 * nests operations (map → iterations → steps, parallel → branches → steps).
 * Execution- and invocation-level events are not operations and are skipped.
 */
export function buildOperations(
  events: HistoryApiEvent[],
  opts: {
    /**
     * Whether the execution has ended and `events` is its whole history.
     * Operations still open then are marked INCOMPLETE rather than shown as
     * running. A terminal execution event in
     * `events` also counts, because the summary can be read before the
     * history and so be older than it.
     */
    executionEnded?: boolean;
  } = {},
): OperationNode[] {
  const byId = new Map<string, OperationNode>();
  const starts = new Map<string, number>();
  let executionEnded = opts.executionEnded ?? false;
  for (const ev of events) {
    const type = ev.EventType ?? "";
    const id = ev.Id;
    if (type.startsWith("Execution") && terminalStatus(type)) {
      executionEnded = true;
    }
    // Execution events carry an Id that is not an operation. Invocation
    // events carry none.
    if (!id || type.startsWith("Execution")) {
      continue;
    }
    let node = byId.get(id);
    if (!node) {
      node = { id, status: "RUNNING" };
      byId.set(id, node);
    }
    if (ev.Name) node.name = ev.Name;
    if (ev.ParentId) node.parentId = ev.ParentId;
    node.kind = kindOf(type, ev.SubType);
    const ts = ev.EventTimestamp?.toISOString();
    const details = detailsOf(ev);

    if (type.endsWith("Started")) {
      // Each Started event is one attempt. A Started after a failure is a
      // retry: the operation is live again, and the earlier attempt's error
      // no longer describes it. The first start time is kept so the duration
      // covers every attempt.
      starts.set(id, (starts.get(id) ?? 0) + 1);
      node.status = "RUNNING";
      node.nextAttemptTime = undefined;
      node.error = undefined;
      node.payloadTruncated = undefined;
      if (!node.startTime) node.startTime = ts;
      if (details?.ScheduledEndTimestamp) {
        node.scheduledEndTime = details.ScheduledEndTimestamp.toISOString();
      }
      if (details?.CallbackId) node.callbackId = details.CallbackId;
      if (details?.FunctionName) node.invokedFunction = details.FunctionName;
      if (details?.DurableExecutionArn) {
        node.invokedExecutionArn = details.DurableExecutionArn;
      }
      continue;
    }

    const status = terminalStatus(type);
    if (!status) continue;
    const result = details?.Result;
    if (result?.Payload !== undefined) node.result = result.Payload;
    const error = details?.Error;
    if (error?.Payload) node.error = formatError(error.Payload);
    if (result?.Truncated || error?.Truncated) node.payloadTruncated = true;
    const next = nextAttemptAt(
      ts,
      details?.RetryDetails?.NextAttemptDelaySeconds,
    );
    if (next) {
      // A next attempt is scheduled, so the operation is waiting, not done.
      // A step records this on a failure with a retry left. A
      // waitForCondition records it on a check that succeeded but whose
      // condition is not met yet.
      node.status = "PENDING";
      node.nextAttemptTime = next;
      continue;
    }
    node.status = status;
    node.endTime = ts;
  }

  for (const [id, node] of byId) {
    // Each Started event is one attempt. A single attempt is not reported:
    // every operation has one, so only a retry is worth showing.
    const n = starts.get(id) ?? 0;
    if (n > 1) node.attempt = n;
    if (
      executionEnded &&
      (node.status === "RUNNING" || node.status === "PENDING")
    ) {
      node.status = "INCOMPLETE";
      node.nextAttemptTime = undefined;
    }
  }

  const roots: OperationNode[] = [];
  for (const node of byId.values()) {
    if (node.startTime && node.endTime) {
      node.durationMs =
        new Date(node.endTime).getTime() - new Date(node.startTime).getTime();
    }
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children ??= [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: OperationNode[]) => {
    arr.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    for (const n of arr) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** One row per InvocationCompleted event, oldest first. */
export function buildInvocations(events: HistoryApiEvent[]): InvocationRow[] {
  const out: InvocationRow[] = [];
  for (const ev of events) {
    if (ev.EventType !== "InvocationCompleted") continue;
    const d = ev.InvocationCompletedDetails;
    out.push({
      requestId: d?.RequestId,
      startTime: d?.StartTimestamp?.toISOString(),
      endTime: d?.EndTimestamp?.toISOString(),
      durationMs: durationBetween(d?.StartTimestamp, d?.EndTimestamp),
      error: d?.Error?.Payload ? formatError(d.Error.Payload) : undefined,
    });
  }
  return out;
}
