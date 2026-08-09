/**
 * Functional tests for the structured tools' RESULT shapes (AC-3.2: every
 * result is machine-readable data, never prose). Injection/escaping is covered
 * separately in `injection.test.ts`.
 */
import {
  configFromWireSettings,
  runAthenaQuery,
  runDynamoDBQuery,
  runAuroraQuery,
  runRedshiftQuery,
  fetchLogsInsightsRecord,
  resolveCredentials,
  type InsightConfig,
} from "@aws/durable-insight-core";
import { MAX_ROWS } from "./readOnlyQuery";
import {
  buildDescribeSchemaResult,
  runGetExecution,
  runListExecutions,
  DEFAULT_RECORD_LOOKBACK_HOURS,
} from "./tools";

jest.mock("@aws/durable-insight-core", () => {
  const actual = jest.requireActual<typeof import("@aws/durable-insight-core")>(
    "@aws/durable-insight-core",
  );
  return {
    ...actual,
    runAthenaQuery: jest.fn(),
    runDynamoDBQuery: jest.fn(),
    runAuroraQuery: jest.fn(),
    runRedshiftQuery: jest.fn(),
    fetchLogsInsightsRecord: jest.fn(),
    resolveCredentials: jest.fn(() => "FAKE_CREDENTIALS"),
  };
});

const runAuroraMock = runAuroraQuery as jest.MockedFunction<
  typeof runAuroraQuery
>;
const runRedshiftMock = runRedshiftQuery as jest.MockedFunction<
  typeof runRedshiftQuery
>;
const logsRecordMock = fetchLogsInsightsRecord as jest.MockedFunction<
  typeof fetchLogsInsightsRecord
>;
/** A representative execution ARN for point lookups. */
const ARN = "arn:aws:lambda:us-east-1:123456789012:function:fn:1#exec-1";
const runAthenaMock = runAthenaQuery as jest.MockedFunction<
  typeof runAthenaQuery
>;
const runDynamoDBMock = runDynamoDBQuery as jest.MockedFunction<
  typeof runDynamoDBQuery
>;

beforeEach(() => jest.clearAllMocks());

function cfgFor(destinationType: string): InsightConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    dynamodbTableName: "my_ddb_table",
    athenaDatabase: "insight_db",
    athenaTable: "my_athena_table",
    athenaOutputLocation: "s3://results-bucket/athena/",
  });
}

describe("describe_schema result", () => {
  it("dynamodb: PartiQL label, table, cap, and the SDK guidance in the result", () => {
    const r = buildDescribeSchemaResult(cfgFor("dynamodb"));
    expect(r.destinationType).toBe("dynamodb");
    expect(r.engine).toBe("PartiQL");
    expect(r.table).toBe("my_ddb_table");
    expect(r.maxRows).toBe(MAX_ROWS);
    // Guidance is present, non-trivial, and its measured length matches.
    expect(r.guidance.length).toBeGreaterThan(500);
    expect(r.guidanceLength).toBe(r.guidance.length);
    // The whole point: the guidance is far larger than any tool description,
    // which is why it lives in the result and not a description.
    expect(r.guidance).toContain("PartiQL");
  });

  it("s3: Trino/Presto SQL label and the Athena table in play", () => {
    const r = buildDescribeSchemaResult(cfgFor("s3"));
    expect(r.engine).toBe("Trino/Presto SQL");
    expect(r.table).toBe("my_athena_table");
    expect(r.guidanceLength).toBe(r.guidance.length);
    expect(r.guidance.length).toBeGreaterThan(500);
  });

  // T4.1: describe_schema now covers all five SQL destinations. buildSystemPrompt
  // already had guidance for all 8 types, so this needed no per-engine work —
  // this asserts each supported type returns a sensible, non-trivial result with
  // the right engine label and a self-consistent guidanceLength.
  it.each([
    ["s3", "Trino/Presto SQL", "Trino/Presto SQL"],
    ["dynamodb", "PartiQL", "PartiQL"],
    ["aurora", "PostgreSQL", "PostgreSQL"],
    ["redshift", "Redshift SQL", "Redshift SQL"],
    ["opensearch", "OpenSearch SQL", "OpenSearch SQL"],
  ] as const)(
    "%s: engine=%s, guidance is non-trivial and self-consistent",
    (dest, engine, needle) => {
      const r = buildDescribeSchemaResult(cfgFor(dest));
      expect(r.destinationType).toBe(dest);
      expect(r.engine).toBe(engine);
      expect(r.maxRows).toBe(MAX_ROWS);
      expect(r.guidance.length).toBeGreaterThan(500);
      expect(r.guidanceLength).toBe(r.guidance.length);
      expect(r.guidance).toContain(needle);
    },
  );

  it("throws for a non-queryable destination (SQS)", () => {
    // SQS is a message queue, not a queryable store; describe_schema must
    // reject it by naming the type.
    expect(() => buildDescribeSchemaResult(cfgFor("sqs"))).toThrow(/sqs/);
  });

  it.each([["cloudwatch-logs-exporter"], ["lambda-log-exporter"]] as const)(
    "%s: now supported — reports the CloudWatch Logs Insights engine with guidance",
    (dest) => {
      // As of Phase 4 the log destinations ARE supported (Logs Insights, not
      // SQL). describe_schema returns the logs engine and non-empty guidance
      // rather than throwing.
      const r = buildDescribeSchemaResult(cfgFor(dest));
      expect(r.engine).toBe("CloudWatch Logs Insights");
      expect(r.guidance.length).toBeGreaterThan(0);
      expect(r.guidanceLength).toBe(r.guidance.length);
    },
  );
});

describe("get_execution found semantics", () => {
  it("reports found=false for a missing record (a success, not an error)", async () => {
    runDynamoDBMock.mockResolvedValue({
      columns: [],
      rows: [],
      count: 0,
      numericColumns: [],
      hasMore: false,
    });
    const r = await runGetExecution(cfgFor("dynamodb"), {
      executionArn: "nope",
    });
    expect(r.found).toBe(false);
    expect(r.record).toBeUndefined();
    expect(r.executionArn).toBe("nope");
  });

  it("reports found=true and maps columns/rows into a record", async () => {
    runDynamoDBMock.mockResolvedValue({
      columns: ["pk", "status"],
      rows: [["arn:1", "SUCCEEDED"]],
      count: 1,
      numericColumns: [false, false],
      hasMore: false,
    });
    const r = await runGetExecution(cfgFor("dynamodb"), {
      executionArn: "arn:1",
    });
    expect(r.found).toBe(true);
    expect(r.record).toEqual({ pk: "arn:1", status: "SUCCEEDED" });
  });
});

describe("list_executions result shape", () => {
  it("returns normalized columns/rows/count/truncated", async () => {
    runAthenaMock.mockResolvedValue({
      columns: ["executionarn", "status"],
      rows: [["arn:1", "FAILED"]],
      count: 1,
      numericColumns: [false, false],
      truncated: false,
    });
    const r = await runListExecutions(cfgFor("s3"), { status: "FAILED" });
    expect(r.engine).toBe("Trino/Presto SQL");
    expect(r.columns).toEqual(["executionarn", "status"]);
    expect(r.count).toBe(1);
    expect(r.truncated).toBe(false);
  });
});

/**
 * `get_execution` must say what it searched, and what it ignored.
 *
 * TWO FAILURES THIS PREVENTS:
 *
 *   1. On a log destination the lookup inherited core's 7-day window with no way to
 *      widen it, and reported a miss as `found: false` -- identical to the result for
 *      an execution that never existed. An agent cannot distinguish "not in the last
 *      week" from "does not exist", so it will confidently report the wrong one.
 *
 *   2. `year`/`month`/`day` are Athena partition hints. Passing them to any other
 *      destination produced no error, no warning and no change in behavior, which
 *      teaches an agent they worked.
 */
describe("get_execution reports its window and its ignored parameters", () => {
  it("reports the default window when none is given", async () => {
    logsRecordMock.mockResolvedValueOnce(undefined);
    const result = await runGetExecution(cfgFor("cloudwatch-logs-exporter"), {
      executionArn: ARN,
    });
    expect(result.found).toBe(false);
    // Without this an agent cannot tell a miss from an absence.
    expect(result.searchedLookbackHours).toBe(DEFAULT_RECORD_LOOKBACK_HOURS);
  });

  it("passes a wider window through to core and reports it", async () => {
    logsRecordMock.mockResolvedValueOnce(undefined);
    const result = await runGetExecution(cfgFor("cloudwatch-logs-exporter"), {
      executionArn: ARN,
      lookbackHours: 720,
    });
    expect(logsRecordMock.mock.calls[0][0].lookbackMs).toBe(
      720 * 60 * 60 * 1000,
    );
    expect(result.searchedLookbackHours).toBe(720);
  });

  it.each([0, -5])(
    "falls back to the default for a %s window",
    async (lookbackHours) => {
      logsRecordMock.mockResolvedValueOnce(undefined);
      const result = await runGetExecution(cfgFor("cloudwatch-logs-exporter"), {
        executionArn: ARN,
        lookbackHours,
      });
      // A zero-hour window would search nothing and always report found=false.
      expect(result.searchedLookbackHours).toBe(DEFAULT_RECORD_LOOKBACK_HOURS);
    },
  );

  it.each(["dynamodb", "aurora", "redshift"])(
    "reports year/month/day as ignored on %s",
    async (destination) => {
      const empty = {
        columns: [],
        rows: [],
        count: 0,
        numericColumns: [],
        hasMore: false,
      };
      runDynamoDBMock.mockResolvedValue(empty);
      runAuroraMock.mockResolvedValue(empty);
      runRedshiftMock.mockResolvedValue(empty);
      const result = await runGetExecution(cfgFor(destination), {
        executionArn: ARN,
        year: "2024",
        month: "01",
      });
      expect(result.ignoredParams).toEqual(["year", "month"]);
    },
  );

  it("does not report partition params as ignored on s3", async () => {
    // Acceptance: on Athena they prune the scan, so flagging them there would be
    // wrong and would train the agent to stop sending them.
    const result = await runGetExecution(cfgFor("s3"), {
      executionArn: ARN,
      year: "2024",
      month: "01",
      day: "31",
    });
    expect(result.ignoredParams).toBeUndefined();
  });

  it("omits ignoredParams entirely when nothing was ignored", async () => {
    const result = await runGetExecution(cfgFor("dynamodb"), {
      executionArn: ARN,
    });
    expect(result.ignoredParams).toBeUndefined();
  });
});
