/**
 * Security tests for the query choke point (AC-T2).
 *
 * The real assertion in every rejection case is NOT merely that an error was
 * thrown — it is that the underlying AWS runner was NEVER invoked. A rejection
 * that still hit the network would be worthless: the write would already have
 * reached the data store. So we mock core's runners and assert the mock was not
 * called. Conversely, the ACCEPT cases assert the runner WAS called and the SQL
 * forwarded — otherwise a function that rejects everything unconditionally would
 * pass a rejection-only suite.
 *
 * `assertReadOnly` itself is deliberately NOT mocked: this suite exercises the
 * real validator from `durable-insight-core`. Only the runners and credential
 * resolution are stubbed.
 *
 * As of Phase 4 T4.1 the matrix runs across ALL FIVE SQL destinations
 * (s3/Athena, DynamoDB, Aurora, Redshift, OpenSearch), not just the original
 * two — the read-only guard and the row cap must hold for every one.
 */
import {
  configFromWireSettings,
  runAthenaQuery,
  runAuroraQuery,
  runDynamoDBQuery,
  runOpenSearchQuery,
  runRedshiftQuery,
  resolveCredentials,
  type InsightConfig,
} from "durable-insight-core";
import { MAX_ROWS, runReadOnlyQuery } from "./readOnlyQuery";

jest.mock("durable-insight-core", () => {
  const actual = jest.requireActual<typeof import("durable-insight-core")>(
    "durable-insight-core",
  );
  return {
    ...actual,
    // Real: assertReadOnly, configFromWireSettings, normalizeConfig, ...
    // Stubbed: every engine runner (so a rejection cannot reach the network)
    // and the credential resolver (so no provider chain is constructed).
    runAthenaQuery: jest.fn(),
    runDynamoDBQuery: jest.fn(),
    runAuroraQuery: jest.fn(),
    runRedshiftQuery: jest.fn(),
    runOpenSearchQuery: jest.fn(),
    resolveCredentials: jest.fn(() => "FAKE_CREDENTIALS"),
  };
});

const runAthenaMock = runAthenaQuery as jest.MockedFunction<
  typeof runAthenaQuery
>;
const runDynamoDBMock = runDynamoDBQuery as jest.MockedFunction<
  typeof runDynamoDBQuery
>;
const runAuroraMock = runAuroraQuery as jest.MockedFunction<
  typeof runAuroraQuery
>;
const runRedshiftMock = runRedshiftQuery as jest.MockedFunction<
  typeof runRedshiftQuery
>;
const runOpenSearchMock = runOpenSearchQuery as jest.MockedFunction<
  typeof runOpenSearchQuery
>;

/** A one-row Athena result (Athena's shape carries `truncated`). */
const ATHENA_OK = {
  columns: ["n"],
  rows: [["1"]],
  count: 1,
  numericColumns: [true],
  truncated: false,
};
/** A one-row result for the runners that DON'T carry `truncated`. */
const PLAIN_OK = {
  columns: ["n"],
  rows: [["1"]],
  count: 1,
  numericColumns: [true],
};

beforeEach(() => {
  jest.clearAllMocks();
  runAthenaMock.mockResolvedValue(ATHENA_OK);
  runDynamoDBMock.mockResolvedValue(PLAIN_OK);
  runAuroraMock.mockResolvedValue(PLAIN_OK);
  runRedshiftMock.mockResolvedValue(PLAIN_OK);
  runOpenSearchMock.mockResolvedValue(PLAIN_OK);
});

function cfgFor(
  destinationType: string,
  extra: Record<string, string> = {},
): InsightConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    dynamodbTableName: "workflow_insight",
    athenaDatabase: "insight_db",
    athenaS3Location: "s3://bucket/prefix/",
    auroraResourceArn: "arn:aws:rds:us-east-1:111:cluster:c1",
    auroraSecretArn: "arn:aws:secretsmanager:us-east-1:111:secret:s1",
    redshiftWorkgroupName: "wg1",
    opensearchEndpoint: "https://os.example.com",
    ...extra,
  });
}

/** Statements that MUST be rejected before any AWS call. */
const REJECTED: Array<[string, string]> = [
  ["INSERT", "INSERT INTO t (a) VALUES (1)"],
  ["UPDATE", "UPDATE t SET a = 1"],
  ["DELETE", "DELETE FROM t"],
  ["DROP", "DROP TABLE t"],
  ["ALTER", "ALTER TABLE t ADD COLUMN a integer"],
  ["CREATE", "CREATE TABLE t (a integer)"],
  ["TRUNCATE", "TRUNCATE TABLE t"],
  ["MERGE", "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE"],
  ["GRANT", "GRANT SELECT ON t TO someone"],
  ["REVOKE", "REVOKE SELECT ON t FROM someone"],
  ["EXECUTE", "EXECUTE some_prepared_statement"],
  ["CALL", "CALL some_procedure()"],
  ["COPY", "COPY t FROM 's3://bucket/key'"],
  ["UNLOAD", "UNLOAD ('SELECT * FROM t') TO 's3://bucket/key'"],
  ["multi-statement", "SELECT 1; DELETE FROM t"],
  ["line-comment obfuscation", "SELECT 1 -- \nDELETE FROM t"],
  ["block-comment obfuscation", "SELECT 1 /* keep reading */\nDELETE FROM t"],
  [
    "data-modifying CTE (write after CTE)",
    "WITH x AS (SELECT 1) DELETE FROM t",
  ],
  [
    "data-modifying CTE (write inside CTE)",
    "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
  ],
  ["empty", ""],
  ["whitespace-only", "   \n\t  "],
];

/** Statements that MUST be accepted and forwarded to the runner. */
const ACCEPTED: Array<[string, string]> = [
  ["plain SELECT", "SELECT id, status FROM t WHERE status = 'RUNNING'"],
  ["read-only CTE", "WITH x AS (SELECT 1 AS n) SELECT * FROM x"],
  [
    "keyword inside a string literal",
    "SELECT * FROM t WHERE status = 'DELETED'",
  ],
  [
    "dangerous keyword as scalar function",
    "SELECT REPLACE(name, 'a', 'b') FROM t",
  ],
];

/** Every supported SQL destination, its runner mock getter, and engine label. */
const ENGINES = [
  ["s3", () => runAthenaMock, "Trino/Presto SQL"],
  ["dynamodb", () => runDynamoDBMock, "PartiQL"],
  ["aurora", () => runAuroraMock, "PostgreSQL"],
  ["redshift", () => runRedshiftMock, "Redshift SQL"],
  ["opensearch", () => runOpenSearchMock, "OpenSearch SQL"],
] as const;

/** Assert NONE of the five runners were invoked (a rejection reached no AWS). */
function expectNoRunnerCalled(): void {
  expect(runAthenaMock).not.toHaveBeenCalled();
  expect(runDynamoDBMock).not.toHaveBeenCalled();
  expect(runAuroraMock).not.toHaveBeenCalled();
  expect(runRedshiftMock).not.toHaveBeenCalled();
  expect(runOpenSearchMock).not.toHaveBeenCalled();
}

describe.each(ENGINES)(
  "runReadOnlyQuery on %s",
  (destinationType, getMock, engine) => {
    const cfg = () => cfgFor(destinationType);

    describe("rejects writes without issuing any AWS call", () => {
      it.each(REJECTED)("rejects %s", async (_label, sql) => {
        await expect(runReadOnlyQuery(cfg(), sql)).rejects.toThrow();
        // THE assertion: no runner was reached, so nothing hit the network.
        expectNoRunnerCalled();
        expect(resolveCredentials).not.toHaveBeenCalled();
      });
    });

    describe("accepts and forwards read-only queries", () => {
      it.each(ACCEPTED)("accepts %s", async (_label, sql) => {
        const result = await runReadOnlyQuery(cfg(), sql);
        expect(getMock()).toHaveBeenCalledTimes(1);
        expect(result.engine).toBe(engine);
        // Accept path is also bounded: a one-row result is under the cap.
        expect(result.rows.length).toBeLessThanOrEqual(MAX_ROWS);
      });
    });
  },
);

describe("Athena dispatch is always bounded", () => {
  it.each(ACCEPTED)(
    "passes maxRows=MAX_ROWS (never undefined) for %s",
    async (_label, sql) => {
      await runReadOnlyQuery(cfgFor("s3"), sql);
      expect(runAthenaMock).toHaveBeenCalledTimes(1);
      const opts = runAthenaMock.mock.calls[0][0];
      expect(opts.maxRows).toBe(MAX_ROWS);
      expect(opts.maxRows).not.toBeUndefined();
    },
  );
});

describe("Athena results go to the output location, not the data bucket", () => {
  // Regression guard for a real bug caught in review. athenaOutputLocation and
  // athenaS3Location are DIFFERENT buckets:
  //   athenaOutputLocation -> where Athena writes query RESULTS
  //   athenaS3Location     -> the SOURCE data location, used for table DDL
  // An earlier draft passed athenaS3Location as `outputLocation`, which would
  // write result files into the data being queried. Every other call site in the
  // repo passes athenaOutputLocation, and athena.ts's own error text names it.
  it("passes athenaOutputLocation, never athenaS3Location", async () => {
    const cfg = {
      ...cfgFor("s3"),
      athenaOutputLocation: "s3://results-bucket/athena/",
      athenaS3Location: "s3://SOURCE-DATA-bucket/records/",
    };
    await runReadOnlyQuery(cfg, "SELECT 1");
    const opts = runAthenaMock.mock.calls[0][0];
    expect(opts.outputLocation).toBe("s3://results-bucket/athena/");
    expect(opts.outputLocation).not.toBe("s3://SOURCE-DATA-bucket/records/");
  });

  it("leaves outputLocation undefined when only a workgroup is set", async () => {
    const cfg = {
      ...cfgFor("s3"),
      athenaWorkgroup: "primary",
      athenaOutputLocation: "",
      athenaS3Location: "s3://SOURCE-DATA-bucket/records/",
    };
    await runReadOnlyQuery(cfg, "SELECT 1");
    const opts = runAthenaMock.mock.calls[0][0];
    expect(opts.outputLocation).toBeUndefined();
    expect(opts.workgroup).toBe("primary");
  });
});

// ── Per-engine row bounding ──────────────────────────────────────────────────
//
// Every destination must come back bounded by MAX_ROWS — but the MECHANISM
// differs, and these tests assert the correct one per engine so a regression in
// any single engine's bound is caught in isolation:
//   - Athena self-bounds (maxRows passed to the runner); the MCP layer must NOT
//     double-slice — it forwards the runner's rows/truncated as-is.
//   - DynamoDB returns a single page; the MCP layer slices at the cap.
//   - Aurora/Redshift/OpenSearch runners apply NO cap, so the MCP layer slices
//     to MAX_ROWS and sets truncated when the runner returned more.

describe("row bounding — runners that do NOT cap (MCP layer slices)", () => {
  const oversized = () => ({
    columns: ["n"],
    rows: Array.from({ length: MAX_ROWS + 5 }, (_, i) => [String(i)]),
    count: MAX_ROWS + 5,
    numericColumns: [true],
  });

  describe.each([
    ["aurora", () => runAuroraMock],
    ["redshift", () => runRedshiftMock],
    ["opensearch", () => runOpenSearchMock],
  ] as const)("%s", (dest, getMock) => {
    it("slices to MAX_ROWS and sets truncated when the runner returns more", async () => {
      getMock().mockResolvedValueOnce(oversized());
      const result = await runReadOnlyQuery(cfgFor(dest), "SELECT * FROM t");
      expect(result.rows.length).toBe(MAX_ROWS);
      expect(result.count).toBe(MAX_ROWS);
      expect(result.truncated).toBe(true);
    });

    it("does not truncate a result at or under the cap", async () => {
      const result = await runReadOnlyQuery(cfgFor(dest), "SELECT * FROM t");
      expect(result.truncated).toBe(false);
      expect(result.rows.length).toBeLessThanOrEqual(MAX_ROWS);
    });
  });
});

describe("row bounding — Athena self-bounds via maxRows", () => {
  it("passes maxRows and surfaces the runner's truncated flag without re-slicing", async () => {
    runAthenaMock.mockResolvedValueOnce({
      columns: ["n"],
      rows: [["1"]],
      count: 1,
      numericColumns: [true],
      truncated: true,
    });
    const result = await runReadOnlyQuery(cfgFor("s3"), "SELECT * FROM t");
    expect(runAthenaMock.mock.calls[0][0].maxRows).toBe(MAX_ROWS);
    expect(result.truncated).toBe(true);
  });
});

describe("row bounding — DynamoDB single page sliced at the cap", () => {
  it("reports truncated=true and slices when the row count reaches the cap", async () => {
    runDynamoDBMock.mockResolvedValueOnce({
      columns: ["n"],
      rows: Array.from({ length: MAX_ROWS + 5 }, (_, i) => [String(i)]),
      count: MAX_ROWS + 5,
      numericColumns: [true],
    });
    const result = await runReadOnlyQuery(
      cfgFor("dynamodb"),
      "SELECT * FROM t",
    );
    expect(result.rows.length).toBe(MAX_ROWS);
    expect(result.count).toBe(MAX_ROWS);
    expect(result.truncated).toBe(true);
  });

  it("reports truncated=false for a small result", async () => {
    const result = await runReadOnlyQuery(
      cfgFor("dynamodb"),
      "SELECT * FROM t",
    );
    expect(result.truncated).toBe(false);
  });
});

// ── Non-queryable and unsupported destinations ───────────────────────────────

describe("sqs is explicitly rejected as non-queryable", () => {
  it("throws an error explaining SQS is tailed, not queried, without any AWS call", async () => {
    await expect(runReadOnlyQuery(cfgFor("sqs"), "SELECT 1")).rejects.toThrow(
      /tail|message queue/i,
    );
    // The rejection must name SQS as non-queryable specifically — not the
    // generic "unsupported destination" text (which would pass a bare toThrow).
    await expect(runReadOnlyQuery(cfgFor("sqs"), "SELECT 1")).rejects.toThrow(
      /sqs/i,
    );
    expectNoRunnerCalled();
    expect(resolveCredentials).not.toHaveBeenCalled();
  });
});

// NOTE: CloudWatch Logs destinations (cloudwatch-logs-exporter,
// lambda-log-exporter) were previously rejected here as "unsupported". As of
// Phase 4 they ARE supported, on a deliberately separate (non-SQL) code path
// that does NOT apply assertReadOnly. That path mocks a different core runner
// (runLogsInsightsQuery), so its coverage lives in its own suite —
// logsInsights.test.ts — rather than in this SQL-runner harness.
