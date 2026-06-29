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
