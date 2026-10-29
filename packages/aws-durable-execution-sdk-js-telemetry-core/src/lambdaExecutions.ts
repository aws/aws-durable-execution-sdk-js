/**
 * Durable executions read straight from the Lambda API, with no exporter in
 * between.
 *
 * Everything else in this package reads what the telemetry exporter wrote to a
 * destination. This module is the other source: the durable-execution APIs
 * Lambda itself serves (`ListDurableExecutionsByFunction`,
 * `GetDurableExecution`, `GetDurableExecutionHistory`). It works for any
 * durable function, whether or not it runs the telemetry plugin, and it is what
 * the execution viewer in every host is built on.
 *
 * Host-free like the rest of core: no `vscode`, `electron`, or MCP import.
 */
import {
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  ListDurableExecutionsByFunctionCommand,
  ListFunctionsCommand,
  StopDurableExecutionCommand,
  type ErrorObject,
  type Event as HistoryApiEvent,
} from "@aws-sdk/client-lambda";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

/** The subset of LambdaClient this module calls; tests pass a fake. */
export interface LambdaSender {
  // biome-ignore lint/suspicious/noExplicitAny: commands are heterogeneous; each call site narrows the output.
  send(command: any): Promise<any>;
}

export interface LambdaContext {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  /**
   * Builds the client for a region. Defaults to a real {@link LambdaClient}.
   * The region is passed because an execution ARN names its own region, which
   * can differ from the configured one.
   */
  clientFor?: (region: string) => LambdaSender;
}

export interface FunctionSummary {
  name: string;
  runtime?: string;
  lastModified?: string;
  packageType?: string;
}

export interface FunctionInfo {
  name: string;
  arn?: string;
  runtime?: string;
  memorySize?: number;
  timeout?: number;
  executionTimeoutSeconds?: number;
  retentionDays?: number;
  lastModified?: string;
  codeSize?: number;
  version?: string;
  handler?: string;
  description?: string;
}

export interface ExecutionRow {
  arn: string;
  name: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
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
  /** Highest attempt number seen (steps with retries). */
  attempt?: number;
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
  /** True when history paging stopped at {@link MAX_HISTORY_EVENTS}. */
  historyTruncated?: boolean;
  /** Set when the history call failed; the execution summary is still valid. */
  historyError?: string;
}

/** Execution statuses after which nothing changes. */
export const TERMINAL_EXECUTION_STATUSES: readonly string[] = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "STOPPED",
];

/**
 * Upper bound on history events loaded for one execution. History pages are
 * fetched until exhausted or this many events are held, so a long-running
 * execution cannot grow host memory or the renderer payload without bound.
 */
export const MAX_HISTORY_EVENTS = 10_000;

const HISTORY_PAGE_SIZE = 1000;
const MAX_EXECUTION_ARN_LENGTH = 2048;
const EXECUTION_MARKER = "/durable-execution/";

function isRegionLike(s: string): boolean {
  if (s.length === 0 || s.length > 32) return false;
  for (const c of s) {
    if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-")) {
      return false;
    }
  }
  return true;
}

function isExecutionTail(s: string): boolean {
  for (const c of s) {
    const ok =
      (c >= "a" && c <= "z") ||
      (c >= "A" && c <= "Z") ||
      (c >= "0" && c <= "9") ||
      c === "-" ||
      c === "_" ||
      c === "." ||
      c === "/";
    if (!ok) return false;
  }
  return !s.startsWith("/") && !s.endsWith("/") && !s.includes("//");
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
  if (/\s/.test(value)) return undefined;
  const at = value.indexOf(EXECUTION_MARKER);
  if (at < 0 || at + EXECUTION_MARKER.length === value.length) return undefined;
  // Execution names and invocation ids use letters, digits, '-', '_' and '.'.
  // Rejecting everything else keeps characters such as ')' out of links built
  // from an ARN, where they would end a Markdown link early.
  if (!isExecutionTail(value.slice(at + EXECUTION_MARKER.length))) {
    return undefined;
  }
  const parts = value.slice(0, at).split(":");
  if (parts.length !== 7 && parts.length !== 8) return undefined;
  const [arn, partition, service, region, account, resource, name] = parts;
  if (
    arn !== "arn" ||
    !partition.startsWith("aws") ||
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
 * Whether `value` is a well-formed durable execution ARN. Used to decide which
 * values get a viewer link, and to reject anything else before it reaches the
 * Lambda API.
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
 * Lists functions in the region that have durable execution enabled. Pages
 * through ListFunctions (50 per page) and reports each partial list so a UI can
 * fill in progressively.
 */
export async function listDurableFunctions(
  ctx: LambdaContext,
  onProgress?: (partial: FunctionSummary[]) => void,
): Promise<FunctionSummary[]> {
  const lambda = clientFor(ctx);
  const out: FunctionSummary[] = [];
  const byName = (a: FunctionSummary, b: FunctionSummary) =>
    a.name.localeCompare(b.name);
  let marker: string | undefined;
  do {
    const res = await lambda.send(
      new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }),
    );
    for (const f of res.Functions ?? []) {
      if (f.DurableConfig && f.FunctionName) {
        out.push({
          name: f.FunctionName,
          runtime: f.Runtime,
          lastModified: f.LastModified,
          packageType: f.PackageType,
        });
      }
    }
    marker = res.NextMarker;
    onProgress?.([...out].sort(byName));
  } while (marker);
  return out.sort(byName);
}

/** Fetches configuration for a single durable function. */
export async function getFunctionInfo(
  ctx: LambdaContext,
  functionName: string,
): Promise<FunctionInfo> {
  const c = await clientFor(ctx).send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );
  return {
    name: c.FunctionName ?? functionName,
    arn: c.FunctionArn,
    runtime: c.Runtime,
    memorySize: c.MemorySize,
    timeout: c.Timeout,
    executionTimeoutSeconds: c.DurableConfig?.ExecutionTimeout,
    retentionDays: c.DurableConfig?.RetentionPeriodInDays,
    lastModified: c.LastModified,
    codeSize: c.CodeSize,
    version: c.Version,
    handler: c.Handler,
    description: c.Description || undefined,
  };
}

/** Lists durable executions for a function, newest first, one page at a time. */
export async function listExecutions(
  ctx: LambdaContext,
  opts: { functionName: string; qualifier?: string; marker?: string },
): Promise<{ executions: ExecutionRow[]; nextMarker?: string }> {
  const res = await clientFor(ctx).send(
    new ListDurableExecutionsByFunctionCommand({
      FunctionName: opts.functionName,
      Qualifier: opts.qualifier,
      ReverseOrder: true,
      MaxItems: 50,
      Marker: opts.marker,
    }),
  );
  const executions: ExecutionRow[] = (res.DurableExecutions ?? []).map(
    // biome-ignore lint/suspicious/noExplicitAny: narrowed field-by-field below.
    (e: any) => ({
      arn: e.DurableExecutionArn ?? "",
      name: e.DurableExecutionName ?? "",
      status: e.Status ?? "",
      startTime: e.StartTimestamp?.toISOString(),
      endTime: e.EndTimestamp?.toISOString(),
      durationMs: durationBetween(e.StartTimestamp, e.EndTimestamp),
    }),
  );
  return { executions, nextMarker: res.NextMarker || undefined };
}

/**
 * Starts a new durable execution by invoking the function asynchronously
 * (InvocationType "Event"); an async durable invoke returns the execution ARN.
 */
export async function startExecution(
  ctx: LambdaContext,
  opts: {
    functionName: string;
    qualifier?: string;
    payload?: string;
    executionName?: string;
  },
): Promise<{ durableExecutionArn?: string }> {
  const payload = opts.payload?.trim() || "{}";
  // Reject malformed JSON here rather than letting the function fail on it.
  JSON.parse(payload);
  const name = opts.executionName?.trim();
  const res = await clientFor(ctx).send(
    new InvokeCommand({
      FunctionName: opts.functionName,
      Qualifier: opts.qualifier || "$LATEST",
      InvocationType: "Event",
      Payload: new TextEncoder().encode(payload),
      ...(name ? { DurableExecutionName: name } : {}),
    }),
  );
  return { durableExecutionArn: res.DurableExecutionArn };
}

/** Asks Lambda to stop a running durable execution (it ends STOPPED). */
export async function stopExecution(
  ctx: LambdaContext,
  arn: string,
): Promise<void> {
  if (!isDurableExecutionArn(arn)) {
    throw new Error(`Not a durable execution ARN: ${arn}`);
  }
  await clientFor(ctx, regionFromExecutionArn(arn)).send(
    new StopDurableExecutionCommand({ DurableExecutionArn: arn }),
  );
}

/**
 * Fetches one durable execution: its summary from GetDurableExecution, plus its
 * full history (paged, bounded by `maxHistoryEvents` and `maxHistoryBytes`)
 * folded into an operation
 * tree. The client targets the region named in the ARN, so a link from a
 * telemetry record in another region still resolves.
 *
 * A history failure does not fail the call: the summary is still useful, and
 * the failure is reported as `historyError` rather than hidden.
 */
export async function getExecution(
  ctx: LambdaContext,
  arn: string,
  opts: {
    maxHistoryEvents?: number;
    /**
     * Stop paging once the history held, measured as the length of its
     * payloads plus a fixed overhead per event, reaches this many bytes. Payloads can be large, so an event count alone does not
     * bound memory. Unset means no byte limit.
     */
    maxHistoryBytes?: number;
  } = {},
): Promise<ExecutionDetail> {
  if (!isDurableExecutionArn(arn)) {
    throw new Error(`Not a durable execution ARN: ${arn}`);
  }
  const maxEvents = opts.maxHistoryEvents ?? MAX_HISTORY_EVENTS;
  const lambda = clientFor(ctx, regionFromExecutionArn(arn));
  const e = await lambda.send(
    new GetDurableExecutionCommand({ DurableExecutionArn: arn }),
  );

  const raw: HistoryApiEvent[] = [];
  let historyBytes = 0;
  let historyTruncated = false;
  let historyError: string | undefined;
  try {
    let marker: string | undefined;
    do {
      const page = await lambda.send(
        new GetDurableExecutionHistoryCommand({
          DurableExecutionArn: arn,
          IncludeExecutionData: true,
          MaxItems: Math.min(HISTORY_PAGE_SIZE, maxEvents - raw.length),
          Marker: marker,
        }),
      );
      const events: HistoryApiEvent[] = page.Events ?? [];
      raw.push(...events);
      if (opts.maxHistoryBytes !== undefined) {
        for (const ev of events) historyBytes += approximateEventBytes(ev);
      }
      marker = page.NextMarker || undefined;
      if (
        marker &&
        (raw.length >= maxEvents ||
          (opts.maxHistoryBytes !== undefined &&
            historyBytes >= opts.maxHistoryBytes))
      ) {
        historyTruncated = true;
        break;
      }
    } while (marker);
  } catch (err) {
    historyError = err instanceof Error ? err.message : String(err);
  }

  return {
    arn: e.DurableExecutionArn ?? arn,
    name: e.DurableExecutionName ?? undefined,
    functionArn: e.FunctionArn ?? undefined,
    status: e.Status ?? "",
    startTime: e.StartTimestamp?.toISOString(),
    endTime: e.EndTimestamp?.toISOString(),
    durationMs: durationBetween(e.StartTimestamp, e.EndTimestamp),
    version: e.Version ?? undefined,
    input: e.InputPayload ?? undefined,
    result: e.Result ?? undefined,
    error: e.Error ? formatError(e.Error) : undefined,
    history: raw.map(toHistoryEvent),
    operations: buildOperations(raw),
    invocations: buildInvocations(raw),
    ...(historyTruncated ? { historyTruncated } : {}),
    ...(historyError ? { historyError } : {}),
  };
}

/** Fixed allowance for an event's non-payload fields. */
const EVENT_OVERHEAD_BYTES = 256;

/**
 * An event's size for the history byte budget: its payload strings plus a
 * fixed overhead. Cheaper than serializing the event, which would allocate a
 * second copy of every payload just to measure it.
 */
function approximateEventBytes(ev: HistoryApiEvent): number {
  let bytes = EVENT_OVERHEAD_BYTES;
  const details = detailsOf(ev) as
    | (DetailFields & { Input?: { Payload?: string } })
    | undefined;
  bytes += details?.Result?.Payload?.length ?? 0;
  bytes += details?.Input?.Payload?.length ?? 0;
  const err = details?.Error?.Payload;
  if (err) {
    bytes +=
      (err.ErrorMessage?.length ?? 0) +
      (err.ErrorType?.length ?? 0) +
      (err.ErrorData?.length ?? 0);
    for (const line of err.StackTrace ?? []) bytes += line.length;
  }
  return bytes;
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
  RetryDetails?: { CurrentAttempt?: number };
  ScheduledEndTimestamp?: Date;
  CallbackId?: string;
  FunctionName?: string;
  DurableExecutionArn?: string;
}

/** The `<EventType>Details` object an event carries, if any. */
function detailsOf(ev: HistoryApiEvent): DetailFields | undefined {
  const type = ev.EventType;
  if (!type) return undefined;
  const v = (ev as Record<string, unknown>)[`${type}Details`];
  return v && typeof v === "object" ? (v as DetailFields) : undefined;
}

/**
 * Folds history events into a forest of operations. Events sharing an `Id` are
 * one operation: a `*Started` event opens it (and re-opens it on a retry), a
 * terminal event closes it with its status, result, and error. `ParentId`
 * nests operations (map → iterations → steps, parallel → branches → steps).
 * Execution- and invocation-level events are not operations and are skipped.
 */
export function buildOperations(events: HistoryApiEvent[]): OperationNode[] {
  const byId = new Map<string, OperationNode>();
  for (const ev of events) {
    const type = ev.EventType ?? "";
    const id = ev.Id;
    if (!id || type.startsWith("Execution") || type.startsWith("Invocation")) {
      continue;
    }
    let node = byId.get(id);
    if (!node) {
      node = { id, status: "RUNNING" };
      byId.set(id, node);
    }
    if (ev.Name) node.name = ev.Name;
    if (ev.ParentId) node.parentId = ev.ParentId;
    if (!node.kind) node.kind = kindOf(type, ev.SubType);
    const ts = ev.EventTimestamp?.toISOString();
    const details = detailsOf(ev);
    const attempt = details?.RetryDetails?.CurrentAttempt;
    if (attempt !== undefined) {
      node.attempt = Math.max(node.attempt ?? 0, attempt);
    }

    if (type.endsWith("Started")) {
      // A Started after a terminal event is a retry: the operation is live
      // again. The first start time is kept so duration covers every attempt.
      node.status = "RUNNING";
      node.endTime = undefined;
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
    node.status = status;
    node.endTime = ts;
    if (!node.startTime) node.startTime = ts;
    const result = details?.Result;
    if (result?.Payload !== undefined) node.result = result.Payload;
    const error = details?.Error;
    if (error?.Payload) node.error = formatError(error.Payload);
    if (result?.Truncated || error?.Truncated) node.payloadTruncated = true;
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
