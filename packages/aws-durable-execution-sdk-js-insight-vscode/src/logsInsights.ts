import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  type ResultField,
} from "@aws-sdk/client-cloudwatch-logs";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface QueryResultTable {
  columns: string[];
  rows: string[][];
  recordsMatched?: number;
  recordsScanned?: number;
}

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 60_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a CloudWatch Logs Insights query and normalize the results into a simple
 * columns/rows table. Logs Insights is asynchronous: we StartQuery, then poll
 * GetQueryResults until the query completes.
 */
export async function runLogsInsightsQuery(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  logGroupNames: string[];
  queryString: string;
  startTimeMs: number;
  endTimeMs: number;
  timeoutMs?: number;
}): Promise<QueryResultTable> {
  if (opts.logGroupNames.length === 0) {
    throw new Error(
      "No log group configured. Set workflowInsight.logGroupName (e.g. /aws/lambda/<your-fn>).",
    );
  }

  const client = new CloudWatchLogsClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const { queryId } = await client.send(
    new StartQueryCommand({
      logGroupNames: opts.logGroupNames,
      queryString: opts.queryString,
      // Logs Insights expects epoch seconds.
      startTime: Math.floor(opts.startTimeMs / 1000),
      endTime: Math.floor(opts.endTimeMs / 1000),
    }),
  );

  if (!queryId) {
    throw new Error("Failed to start Logs Insights query (no queryId).");
  }

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (;;) {
    const result = await client.send(new GetQueryResultsCommand({ queryId }));
    const status = result.status;

    if (status === "Complete") {
      return normalize(result.results ?? [], result.statistics);
    }
    if (status === "Failed" || status === "Cancelled" || status === "Timeout") {
      throw new Error(`Logs Insights query ${status?.toLowerCase()}.`);
    }
    if (Date.now() > deadline) {
      // Best-effort stop; ignore failures.
      throw new Error(
        "Logs Insights query timed out while polling for results.",
      );
    }
    await delay(POLL_INTERVAL_MS);
  }
}

/** Convert Logs Insights field/value pairs into ordered columns + rows. */
function normalize(
  results: ResultField[][],
  statistics?: { recordsMatched?: number; recordsScanned?: number },
): QueryResultTable {
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const row of results) {
    for (const field of row) {
      const name = field.field;
      // @ptr is an internal pointer to the raw log event; not useful in a table.
      if (name && name !== "@ptr" && !seen.has(name)) {
        seen.add(name);
        columns.push(name);
      }
    }
  }

  const rows = results.map((row) => {
    const byField = new Map(row.map((f) => [f.field, f.value]));
    return columns.map((c) => byField.get(c) ?? "");
  });

  return {
    columns,
    rows,
    recordsMatched: statistics?.recordsMatched,
    recordsScanned: statistics?.recordsScanned,
  };
}

/**
 * Fetch a single full record by executionArn, for the row-detail
 * drill-down. Logs Insights has no point-lookup API — this runs an ordinary
 * (but narrowly filtered) query over a generous lookback window, since a
 * click can target a record from any time range the original query covered.
 * Slower than the other destinations' point lookups (a fresh Logs Insights
 * query, not a cheap keyed read), but still just a few seconds.
 *
 * Handles both destination formats this module's queries can target:
 * "direct" (CloudWatchLogsExporter, raw JSON fields) and "nested"
 * (LambdaLogExporter, JSON string in a `message` field) — tries a
 * field-based match first, then a message-substring match.
 */
export async function fetchLogsInsightsRecord(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  logGroupNames: string[];
  executionArn: string;
  lookbackMs?: number;
}): Promise<Record<string, string> | undefined> {
  const escaped = opts.executionArn.replace(/"/g, '\\"');
  const endTimeMs = Date.now();
  const startTimeMs = endTimeMs - (opts.lookbackMs ?? 7 * 24 * 60 * 60 * 1000);

  // Try the "direct" shape first: executionArn is a top-level field.
  const direct = await runLogsInsightsQuery({
    region: opts.region,
    credentials: opts.credentials,
    logGroupNames: opts.logGroupNames,
    queryString: `filter executionArn = "${escaped}" | fields @message | sort @timestamp desc | limit 1`,
    startTimeMs,
    endTimeMs,
  }).catch(() => undefined);

  const directMessage = direct?.rows[0]?.[direct.columns.indexOf("@message")];
  if (directMessage) {
    const parsed = tryParseRecord(directMessage);
    if (parsed) return parsed;
  }

  // Fall back to the "nested" shape: executionArn is inside a JSON string in
  // the `message` field (LambdaLogExporter's envelope).
  const nested = await runLogsInsightsQuery({
    region: opts.region,
    credentials: opts.credentials,
    logGroupNames: opts.logGroupNames,
    queryString: `filter message like /${escapeRegex(opts.executionArn)}/ | fields @message | sort @timestamp desc | limit 1`,
    startTimeMs,
    endTimeMs,
  }).catch(() => undefined);

  const nestedMessage = nested?.rows[0]?.[nested.columns.indexOf("@message")];
  if (nestedMessage) {
    // The envelope's `message` field is itself a JSON-serialized
    // WorkflowInsightRecord string, one level deeper than @message here.
    const outer = tryParseRecord(nestedMessage);
    if (outer && typeof outer.message === "string") {
      const inner = tryParseRecord(outer.message);
      if (inner) return inner;
    }
    if (outer) return outer;
  }

  return undefined;
}

function tryParseRecord(raw: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record: Record<string, string> = {};
    for (const [key, val] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (val == null) continue;
      record[key] = typeof val === "object" ? JSON.stringify(val) : String(val);
    }
    return record;
  } catch {
    return undefined;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
