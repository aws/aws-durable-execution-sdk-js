/**
 * Tests for the CloudWatch Logs Insights query path (Phase 4).
 *
 * WHY THIS SUITE IS SHAPED DIFFERENTLY FROM readOnlyQuery.test.ts:
 *   The five SQL engines are guarded by `assertReadOnly`, so their suite proves
 *   that BAD input (writes) is rejected. The Logs Insights path is the exact
 *   inverse: `assertReadOnly` MUST NOT run here (it requires SELECT/WITH and
 *   would reject every valid pipe query), so the critical property to prove is
 *   that VALID Logs Insights queries are ACCEPTED and reach the runner. The
 *   plausible future regression is someone adding `assertReadOnly` "for
 *   consistency" and silently breaking every log query — the accept tests below
 *   are the guard against exactly that.
 *
 * `assertReadOnly` and `ensureLimit` are the REAL implementations from core
 * (not mocked): the accept tests only pass because the log path never calls
 * `assertReadOnly`, and the bounding tests only pass because it does call
 * `ensureLimit`. Only the async boundaries are stubbed:
 *   - `runLogsInsightsQuery`   — capture the query string + window, no network.
 *   - `fetchLogsInsightsRecord`— capture the get_execution lookup, no network.
 *   - `resolveCredentials`     — no provider chain constructed.
 */
import {
  configFromWireSettings,
  escapeQuotedString,
  fetchLogsInsightsRecord,
  runLogsInsightsQuery,
  resolveCredentials,
  type InsightConfig,
  type QueryResultTable,
} from "@aws/durable-insight-core";
import {
  DEFAULT_LOG_TIME_RANGE_MS,
  LOGS_INSIGHTS_ENGINE,
  MAX_ROWS,
  runReadOnlyQuery,
} from "./readOnlyQuery";
import {
  buildDescribeSchemaResult,
  buildListExecutionsLogsQuery,
  runGetExecution,
  runListExecutions,
} from "./tools";

jest.mock("@aws/durable-insight-core", () => {
  const actual = jest.requireActual<typeof import("@aws/durable-insight-core")>(
    "@aws/durable-insight-core",
  );
  return {
    ...actual,
    // Real: assertReadOnly, ensureLimit, escapeQuotedString, buildSystemPrompt,
    //       configFromWireSettings, normalizeConfig, ...
    // Stubbed: the two async log boundaries + credential resolution.
    runLogsInsightsQuery: jest.fn(),
    fetchLogsInsightsRecord: jest.fn(),
    resolveCredentials: jest.fn(() => "FAKE_CREDENTIALS"),
  };
});

const runLogsMock = runLogsInsightsQuery as jest.MockedFunction<
  typeof runLogsInsightsQuery
>;
const fetchRecordMock = fetchLogsInsightsRecord as jest.MockedFunction<
  typeof fetchLogsInsightsRecord
>;

const EMPTY_TABLE: QueryResultTable = {
  columns: [],
  rows: [],
  recordsMatched: 0,
  recordsScanned: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  runLogsMock.mockResolvedValue(EMPTY_TABLE);
  fetchRecordMock.mockResolvedValue(undefined);
});

/** Both CloudWatch Logs Insights destination types. */
const LOG_TYPES = ["cloudwatch-logs-exporter", "lambda-log-exporter"] as const;

function cfgFor(
  destinationType: string,
  logGroupName = "/aws/lambda/fn",
): InsightConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    logGroupName,
  });
}

/** The queryString handed to the (mocked) Logs Insights runner on call N. */
function queryStringAt(n = 0): string {
  expect(runLogsMock.mock.calls.length).toBeGreaterThan(n);
  return runLogsMock.mock.calls[n][0].queryString;
}

// ── The inverted guard: VALID Logs Insights queries are ACCEPTED ─────────────

const VALID_QUERIES: Array<[string, string]> = [
  [
    "fields + filter + sort",
    'fields @timestamp, @message | filter recordType = "WorkflowInsight" | sort @timestamp desc',
  ],
  ["stats aggregation", "fields @timestamp | stats count() by status"],
  ["filter then fields", 'filter status = "FAILED" | fields executionArn'],
];

describe.each(LOG_TYPES)(
  "runReadOnlyQuery on %s ACCEPTS valid Logs Insights queries (never assertReadOnly)",
  (destinationType) => {
    it.each(VALID_QUERIES)("accepts and runs: %s", async (_label, query) => {
      // The whole point: this resolves (is NOT rejected). If someone adds
      // assertReadOnly to the log path, the real validator rejects a query that
      // does not start with SELECT/WITH and this line throws.
      const result = await runReadOnlyQuery(cfgFor(destinationType), query);
      expect(runLogsMock).toHaveBeenCalledTimes(1);
      expect(result.engine).toBe(LOGS_INSIGHTS_ENGINE);
    });
  },
);

// ── ensureLimit is applied on the log path (and only where appropriate) ──────

describe.each(LOG_TYPES)("ensureLimit bounding on %s", (destinationType) => {
  it("appends `| limit MAX_ROWS` to a non-aggregating query without a limit", async () => {
    await runReadOnlyQuery(
      cfgFor(destinationType),
      'filter status = "FAILED" | fields executionArn',
    );
    expect(queryStringAt()).toBe(
      `filter status = "FAILED" | fields executionArn | limit ${MAX_ROWS}`,
    );
  });

  it("leaves a query that already contains `limit` unchanged", async () => {
    await runReadOnlyQuery(
      cfgFor(destinationType),
      'filter status = "FAILED" | fields executionArn | limit 5',
    );
    const q = queryStringAt();
    expect(q).toBe('filter status = "FAILED" | fields executionArn | limit 5');
    // No second limit was appended.
    expect(q.match(/\blimit\b/gi)?.length).toBe(1);
  });

  it("leaves a `stats` aggregation alone (no limit appended)", async () => {
    await runReadOnlyQuery(
      cfgFor(destinationType),
      "fields @timestamp | stats count() by status",
    );
    const q = queryStringAt();
    expect(q).toBe("fields @timestamp | stats count() by status");
    expect(q).not.toMatch(/\blimit\b/i);
  });
});

// ── Explicit time window is ALWAYS supplied ──────────────────────────────────

describe.each(LOG_TYPES)("time window on %s", (destinationType) => {
  it("always passes numeric startTimeMs/endTimeMs with endTimeMs >= startTimeMs", async () => {
    await runReadOnlyQuery(cfgFor(destinationType), "fields @timestamp");
    const opts = runLogsMock.mock.calls[0][0];
    expect(typeof opts.startTimeMs).toBe("number");
    expect(typeof opts.endTimeMs).toBe("number");
    expect(opts.endTimeMs).toBeGreaterThanOrEqual(opts.startTimeMs);
  });

  it("uses the 24h default window when no time range is given", async () => {
    await runReadOnlyQuery(cfgFor(destinationType), "fields @timestamp");
    const opts = runLogsMock.mock.calls[0][0];
    expect(opts.endTimeMs - opts.startTimeMs).toBe(DEFAULT_LOG_TIME_RANGE_MS);
  });

  it("honors an explicit timeRangeMs option", async () => {
    const oneHour = 60 * 60 * 1000;
    await runReadOnlyQuery(cfgFor(destinationType), "fields @timestamp", {
      timeRangeMs: oneHour,
    });
    const opts = runLogsMock.mock.calls[0][0];
    expect(opts.endTimeMs - opts.startTimeMs).toBe(oneHour);
  });
});

// ── logGroupNames is passed through as the array from config ─────────────────

describe.each(LOG_TYPES)("log groups on %s", (destinationType) => {
  it("passes cfg.logGroupNames (the array) straight through", async () => {
    const cfg = cfgFor(destinationType, "/aws/lambda/a,/aws/lambda/b");
    await runReadOnlyQuery(cfg, "fields @timestamp");
    const opts = runLogsMock.mock.calls[0][0];
    expect(opts.logGroupNames).toEqual(["/aws/lambda/a", "/aws/lambda/b"]);
    // Confirm it really is the multi-element array from config, not a string.
    expect(Array.isArray(opts.logGroupNames)).toBe(true);
    expect(cfg.logGroupNames).toEqual(["/aws/lambda/a", "/aws/lambda/b"]);
  });
});

// ── Escaping — proven on the ACTUAL generated query string ───────────────────
//
// list_executions is where THIS package interpolates an agent-supplied value
// into a Logs Insights literal, so it is where the escaping must be proven.
// The correct escaper is core's escapeQuotedString (backslashes first, then
// double quotes). Swapping it for the SQL single-quote doubler (escapeSqlString)
// leaves a trailing backslash unescaped and lets the value break out of the
// double-quoted literal — the trailing-backslash test below is what catches it.

describe.each(LOG_TYPES)(
  "list_executions escapes an injected functionName on %s",
  (destinationType) => {
    it("a value carrying a closing quote + pipe cannot break out of the literal", async () => {
      const q = buildListExecutionsLogsQuery(cfgFor(destinationType), {
        functionName: 'x" | fields @message',
      });
      // The `"` is escaped to `\"`, so the pipe stays INSIDE the literal.
      expect(q).toContain('functionName = "x\\" | fields @message"');
      // The un-escaped breakout form (quote-x-quote) must NOT appear.
      expect(q).not.toContain('functionName = "x" |');
    });

    it("a value ending in a backslash is escaped so the closing quote survives", async () => {
      // Input is the two-char string  x\  — a lone trailing backslash.
      const q = buildListExecutionsLogsQuery(cfgFor(destinationType), {
        functionName: "x\\",
      });
      // Correct (escapeQuotedString): the backslash is doubled -> `x\\`, so the
      // closing quote is a real terminator: functionName = "x\\"
      expect(q).toContain('functionName = "x\\\\"');
      // Cross-check against the real escaper (diverges the moment production
      // swaps in escapeSqlString, which would leave a single backslash).
      expect(q).toContain(`functionName = "${escapeQuotedString("x\\")}"`);
    });
  },
);

// get_execution routes through core's fetchLogsInsightsRecord, which escapes the
// executionArn with escapeQuotedString internally (covered by core's
// logsInsights.test.ts, incl. the trailing-backslash case). Here we prove the
// MCP layer forwards the raw arn + the log-group ARRAY to that helper.
describe.each(LOG_TYPES)("get_execution on %s", (destinationType) => {
  it("forwards executionArn and the logGroupNames array to fetchLogsInsightsRecord", async () => {
    const cfg = cfgFor(destinationType, "/aws/lambda/a,/aws/lambda/b");
    await runGetExecution(cfg, { executionArn: "arn:aws:lambda:exec/1" });
    expect(fetchRecordMock).toHaveBeenCalledTimes(1);
    const opts = fetchRecordMock.mock.calls[0][0];
    expect(opts.executionArn).toBe("arn:aws:lambda:exec/1");
    expect(opts.logGroupNames).toEqual(["/aws/lambda/a", "/aws/lambda/b"]);
  });

  it("maps a missing record to found=false (not an error)", async () => {
    fetchRecordMock.mockResolvedValueOnce(undefined);
    const res = await runGetExecution(cfgFor(destinationType), {
      executionArn: "arn:missing",
    });
    expect(res.found).toBe(false);
    expect(res.engine).toBe(LOGS_INSIGHTS_ENGINE);
    expect(res.record).toBeUndefined();
  });

  it("maps a present record to found=true with the record", async () => {
    fetchRecordMock.mockResolvedValueOnce({
      executionArn: "arn:x",
      status: "SUCCEEDED",
    });
    const res = await runGetExecution(cfgFor(destinationType), {
      executionArn: "arn:x",
    });
    expect(res.found).toBe(true);
    expect(res.record).toEqual({ executionArn: "arn:x", status: "SUCCEEDED" });
  });
});

// ── list_executions runs through the choke point and is bounded ──────────────

describe.each(LOG_TYPES)(
  "list_executions dispatch on %s",
  (destinationType) => {
    it("validates status against the closed enum (rejects before any runner call)", async () => {
      await expect(
        runListExecutions(cfgFor(destinationType), { status: "x' OR '1'='1" }),
      ).rejects.toThrow(/status/i);
      expect(runLogsMock).not.toHaveBeenCalled();
    });

    it("builds a pipe query (NOT SQL), runs it, and reports the logs engine", async () => {
      const res = await runListExecutions(cfgFor(destinationType), {
        status: "FAILED",
      });
      expect(res.engine).toBe(LOGS_INSIGHTS_ENGINE);
      const q = queryStringAt();
      // A pipe query, never SQL.
      expect(q).not.toMatch(/^\s*SELECT\b/i);
      expect(q).toContain("filter ");
      // Bounded: the builder appends its own limit, so ensureLimit leaves it be.
      expect(q).toMatch(/\| limit \d+$/);
    });
  },
);

// ── describe_schema covers both log types (guidance in the RESULT) ───────────

describe.each(LOG_TYPES)("describe_schema on %s", (destinationType) => {
  it("reports the logs engine, the log groups as the table, and non-empty guidance", () => {
    const cfg = cfgFor(destinationType, "/aws/lambda/a,/aws/lambda/b");
    const res = buildDescribeSchemaResult(cfg);
    expect(res.engine).toBe(LOGS_INSIGHTS_ENGINE);
    expect(res.table).toBe("/aws/lambda/a, /aws/lambda/b");
    expect(res.guidance.length).toBeGreaterThan(0);
    expect(res.guidanceLength).toBe(res.guidance.length);
  });
});
