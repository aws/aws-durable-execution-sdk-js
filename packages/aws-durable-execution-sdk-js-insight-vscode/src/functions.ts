import {
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  ListDurableExecutionsByFunctionCommand,
  ListFunctionsCommand,
  ListTagsCommand,
  StopDurableExecutionCommand,
} from "@aws-sdk/client-lambda";
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import type { Event as HistoryApiEvent } from "@aws-sdk/client-lambda";
import AdmZip from "adm-zip";
import {
  WORKFLOW_DAR_FILENAME,
  WORKFLOW_DAR_TS_FILENAME,
  WORKFLOW_DAR_TAG_KEY,
  WORKFLOW_DAR_TAG_VALUE,
} from "@aws/durable-execution-sdk-js-cdk";

export interface AwsContext {
  region: string;
  credentials: AwsCredentialIdentityProvider;
}

export interface FunctionSummary {
  name: string;
  runtime?: string;
  lastModified?: string;
  packageType?: string;
}

export interface FunctionInfo {
  name: string;
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
  /** True when the package embeds an editable `.dar` (Workflow Studio tag). */
  editable?: boolean;
}

export interface ExecutionRow {
  arn: string;
  name: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
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
  history?: HistoryEvent[];
  operations?: OperationNode[];
}

/** One event in a durable execution's history (an operation / node event). */
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
 * An operation aggregated from its history events (start + terminal), forming a
 * tree via {@link OperationNode.parentId} (map → iterations → steps, etc.).
 */
export interface OperationNode {
  id: string;
  parentId?: string;
  name?: string;
  kind?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  result?: string;
  error?: string;
  children?: OperationNode[];
}

/** Lists functions in the region that have durable execution enabled. */
export async function listDurableFunctions(
  ctx: AwsContext,
  onProgress?: (partial: FunctionSummary[]) => void,
): Promise<FunctionSummary[]> {
  const lambda = new LambdaClient(ctx);
  const out: FunctionSummary[] = [];
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
    // Stream partial results after each page so the UI can populate the list
    // progressively — the account may have thousands of functions and
    // ListFunctions is capped at 50 per (sequential) page.
    onProgress?.([...out].sort((a, b) => a.name.localeCompare(b.name)));
  } while (marker);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Lists durable functions tagged with {@link WORKFLOW_DAR_TAG_KEY} — i.e. those
 * whose deployment package embeds an editable `.dar` (deployed from Studio or
 * the CDK construct). Uses the Resource Groups Tagging API to filter
 * **server-side** in one paginated query, instead of listing every function in
 * the account and calling `ListTags` per function (which scaled with the total
 * durable-function count and was slow).
 */
export async function listWorkflowStudioFunctions(
  ctx: AwsContext,
): Promise<FunctionSummary[]> {
  const tagging = new ResourceGroupsTaggingAPIClient(ctx);
  const arns: string[] = [];
  let token: string | undefined;
  do {
    const res = await tagging.send(
      new GetResourcesCommand({
        ResourceTypeFilters: ["lambda:function"],
        TagFilters: [
          { Key: WORKFLOW_DAR_TAG_KEY, Values: [WORKFLOW_DAR_TAG_VALUE] },
        ],
        ResourcesPerPage: 100,
        PaginationToken: token,
      }),
    );
    for (const r of res.ResourceTagMappingList ?? []) {
      if (r.ResourceARN) arns.push(r.ResourceARN);
    }
    // The tagging API signals "no more pages" with an empty PaginationToken.
    token = res.PaginationToken || undefined;
  } while (token);

  // Fetch the runtime for the (typically small) tagged set with bounded
  // concurrency; a failure degrades gracefully to an unknown runtime.
  const lambda = new LambdaClient(ctx);
  const summaries = await mapWithConcurrency(arns, 6, async (arn) => {
    const name = functionNameFromArn(arn);
    try {
      const cfg = await lambda.send(
        new GetFunctionConfigurationCommand({ FunctionName: arn }),
      );
      return { name, runtime: cfg.Runtime };
    } catch {
      return { name, runtime: undefined as string | undefined };
    }
  });
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Extracts the function name from a Lambda function ARN. */
function functionNameFromArn(arn: string): string {
  // arn:aws:lambda:region:acct:function:NAME[:qualifier]
  return arn.split(":")[6] ?? arn;
}

/** Maps `items` through `fn` with at most `limit` promises in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Downloads a function's deployment package and returns the embedded
 * workflow text — `workflow.dar.ts` for functions deployed after this
 * format switched to `.dar.ts` (dar-ts-specification.md's Phase 2), or the
 * legacy `workflow.dar.json` for functions deployed before then. Returns
 * `null` if the package has no such file. The RAW text is returned
 * as-is — callers that need the JSON-model shape (e.g. before posting to
 * the webview) must run it through `workflowFileToJsonText` themselves,
 * since this function has no way to know which format it downloaded without
 * that same content-sniffing (a `.dar.ts` file starts with a function/const
 * declaration, not `{`).
 */
export async function getWorkflowDar(
  ctx: AwsContext,
  functionName: string,
): Promise<string | null> {
  const lambda = new LambdaClient(ctx);
  const res = await lambda.send(
    new GetFunctionCommand({ FunctionName: functionName }),
  );
  // Skip the (potentially large) code download for functions that weren't
  // deployed from Studio / the CDK construct — they can't have an embedded dar.
  // GetFunction omits Tags when a qualifier (e.g. ":$LATEST") is present (tags
  // are function-level), so fall back to ListTags on the unqualified ARN.
  let tagged = res.Tags?.[WORKFLOW_DAR_TAG_KEY] === WORKFLOW_DAR_TAG_VALUE;
  const arn = res.Configuration?.FunctionArn;
  if (!tagged && arn) {
    try {
      const t = await lambda.send(
        new ListTagsCommand({ Resource: unqualifiedFunctionArn(arn) }),
      );
      tagged = t.Tags?.[WORKFLOW_DAR_TAG_KEY] === WORKFLOW_DAR_TAG_VALUE;
    } catch {
      // Ignore — treated as not tagged below.
    }
  }
  if (!tagged) return null;
  const url = res.Code?.Location;
  if (!url) return null;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to download code package (HTTP ${resp.status}).`);
  }
  const zip = new AdmZip(Buffer.from(await resp.arrayBuffer()));
  const tsEntry = zip.getEntry(WORKFLOW_DAR_TS_FILENAME);
  if (tsEntry) return tsEntry.getData().toString("utf-8");
  const jsonEntry = zip.getEntry(WORKFLOW_DAR_FILENAME);
  return jsonEntry ? jsonEntry.getData().toString("utf-8") : null;
}

/** Strips a trailing `:version`/`:alias`/`:$LATEST` qualifier from a function ARN. */
function unqualifiedFunctionArn(arn: string): string {
  const parts = arn.split(":");
  // arn:aws:lambda:region:acct:function:name[:qualifier] — 7 segments when
  // unqualified, 8 when a qualifier is appended.
  return parts.length > 7 ? parts.slice(0, 7).join(":") : arn;
}

/** Fetches metadata for a single durable function. */
export async function getFunctionInfo(
  ctx: AwsContext,
  functionName: string,
): Promise<FunctionInfo> {
  const lambda = new LambdaClient(ctx);
  const c = await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );
  // A function is editable in Workflow Studio when its package embeds a `.dar`,
  // flagged by the WORKFLOW_DAR_TAG_KEY tag. Checked via ListTags (cheap; no
  // package download); failures (e.g. missing tag:GetResources) => not editable.
  let editable = false;
  try {
    if (c.FunctionArn) {
      const t = await lambda.send(
        new ListTagsCommand({
          Resource: unqualifiedFunctionArn(c.FunctionArn),
        }),
      );
      editable = t.Tags?.[WORKFLOW_DAR_TAG_KEY] === WORKFLOW_DAR_TAG_VALUE;
    }
  } catch {
    editable = false;
  }
  return {
    name: c.FunctionName ?? functionName,
    runtime: c.Runtime,
    memorySize: c.MemorySize,
    timeout: c.Timeout,
    executionTimeoutSeconds: c.DurableConfig?.ExecutionTimeout,
    retentionDays: c.DurableConfig?.RetentionPeriodInDays,
    lastModified: c.LastModified,
    codeSize: c.CodeSize,
    version: c.Version,
    handler: c.Handler,
    description: c.Description,
    editable,
  };
}

/** Lists durable executions for a function, newest first, one page at a time. */
export async function listExecutions(
  ctx: AwsContext,
  opts: { functionName: string; qualifier?: string; marker?: string },
): Promise<{ executions: ExecutionRow[]; nextMarker?: string }> {
  const lambda = new LambdaClient(ctx);
  const res = await lambda.send(
    new ListDurableExecutionsByFunctionCommand({
      FunctionName: opts.functionName,
      Qualifier: opts.qualifier,
      ReverseOrder: true,
      MaxItems: 50,
      Marker: opts.marker,
    }),
  );
  const executions: ExecutionRow[] = (res.DurableExecutions ?? []).map((e) => {
    const start = e.StartTimestamp?.getTime();
    const end = e.EndTimestamp?.getTime();
    return {
      arn: e.DurableExecutionArn ?? "",
      name: e.DurableExecutionName ?? "",
      status: e.Status ?? "",
      startTime: e.StartTimestamp?.toISOString(),
      endTime: e.EndTimestamp?.toISOString(),
      durationMs:
        start !== undefined && end !== undefined ? end - start : undefined,
    };
  });
  return { executions, nextMarker: res.NextMarker };
}

/**
 * Starts a new durable execution by invoking the function **asynchronously**
 * (InvocationType: "Event"). Durable async invokes return the execution ARN.
 */
export async function startExecution(
  ctx: AwsContext,
  opts: {
    functionName: string;
    qualifier?: string;
    payload?: string;
    executionName?: string;
  },
): Promise<{ statusCode?: number; durableExecutionArn?: string }> {
  const lambda = new LambdaClient(ctx);
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: opts.functionName,
      Qualifier: opts.qualifier ?? "$LATEST",
      InvocationType: "Event",
      Payload: new TextEncoder().encode(opts.payload?.trim() || "{}"),
      ...(opts.executionName?.trim()
        ? { DurableExecutionName: opts.executionName.trim() }
        : {}),
    }),
  );
  return {
    statusCode: res.StatusCode,
    durableExecutionArn: res.DurableExecutionArn,
  };
}

/** Requests a running durable execution to stop (marks it STOPPED). */
export async function stopExecution(
  ctx: AwsContext,
  arn: string,
): Promise<void> {
  const lambda = new LambdaClient(ctx);
  await lambda.send(
    new StopDurableExecutionCommand({ DurableExecutionArn: arn }),
  );
}

/** Fetches full detail for one durable execution. */
export async function getExecution(
  ctx: AwsContext,
  arn: string,
): Promise<ExecutionDetail> {
  const lambda = new LambdaClient(ctx);
  const e = await lambda.send(
    new GetDurableExecutionCommand({ DurableExecutionArn: arn }),
  );
  const start = e.StartTimestamp?.getTime();
  const end = e.EndTimestamp?.getTime();
  let history: HistoryEvent[] = [];
  let operations: OperationNode[] = [];
  try {
    const h = await lambda.send(
      new GetDurableExecutionHistoryCommand({
        DurableExecutionArn: arn,
        IncludeExecutionData: true,
        MaxItems: 1000,
      }),
    );
    const raw = h.Events ?? [];
    history = raw.map((ev) => ({
      eventId: ev.EventId,
      type: ev.EventType,
      subType: ev.SubType,
      name: ev.Name,
      id: ev.Id,
      parentId: ev.ParentId,
      timestamp: ev.EventTimestamp?.toISOString(),
    }));
    operations = buildOperations(raw);
  } catch {
    // History is best-effort; the core detail is still useful without it.
  }
  return {
    arn: e.DurableExecutionArn ?? arn,
    name: e.DurableExecutionName ?? undefined,
    functionArn: e.FunctionArn ?? undefined,
    status: e.Status ?? "",
    startTime: e.StartTimestamp?.toISOString(),
    endTime: e.EndTimestamp?.toISOString(),
    durationMs:
      start !== undefined && end !== undefined ? end - start : undefined,
    version: e.Version ?? undefined,
    input: e.InputPayload ?? undefined,
    result: e.Result ?? undefined,
    error: e.Error ? JSON.stringify(e.Error, null, 2) : undefined,
    history,
    operations,
  };
}

const END_STATUS: Record<string, string> = {
  Succeeded: "SUCCEEDED",
  Failed: "FAILED",
  TimedOut: "TIMED_OUT",
  Stopped: "STOPPED",
  Cancelled: "CANCELLED",
};

function terminalStatus(type: string): string | undefined {
  for (const suffix of Object.keys(END_STATUS)) {
    if (type.endsWith(suffix)) return END_STATUS[suffix];
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

/** Pulls a result/error payload out of whichever `*Details` an event carries. */
function resultError(ev: HistoryApiEvent): { result?: string; error?: string } {
  for (const [k, v] of Object.entries(ev as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    if (k.endsWith("SucceededDetails")) {
      const payload = (v as { Result?: { Payload?: string } }).Result?.Payload;
      if (typeof payload === "string") return { result: payload };
    }
    if (k.endsWith("FailedDetails")) {
      const payload = (v as { Error?: { Payload?: unknown } }).Error?.Payload;
      if (payload !== undefined)
        return { error: JSON.stringify(payload, null, 2) };
    }
  }
  return {};
}

/**
 * Aggregates history events into a forest of operations. Events sharing an `Id`
 * are one operation (its `*Started` gives the start, its terminal event gives
 * the end/status/result); `parentId` nests them (map → iterations → steps,
 * parallel → branches → steps). Execution-level events are excluded.
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
    if (type.endsWith("Started") && !node.startTime) node.startTime = ts;
    const status = terminalStatus(type);
    if (status) {
      node.status = status;
      node.endTime = ts;
      if (!node.startTime) node.startTime = ts;
      const re = resultError(ev);
      if (re.result !== undefined) node.result = re.result;
      if (re.error !== undefined) node.error = re.error;
    }
  }
  const roots: OperationNode[] = [];
  for (const node of byId.values()) {
    if (node.startTime && node.endTime) {
      node.durationMs =
        new Date(node.endTime).getTime() - new Date(node.startTime).getTime();
    }
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  }
  const sortRec = (arr: OperationNode[]) => {
    arr.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    for (const n of arr) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
