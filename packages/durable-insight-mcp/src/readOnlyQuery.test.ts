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
 */
import {
  configFromWireSettings,
  runAthenaQuery,
  runDynamoDBQuery,
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
    // Stubbed: the runners (so a rejection cannot reach the network) and the
    // credential resolver (so no provider chain is constructed).
    runAthenaQuery: jest.fn(),
    runDynamoDBQuery: jest.fn(),
    resolveCredentials: jest.fn(() => "FAKE_CREDENTIALS"),
  };
});

const runAthenaMock = runAthenaQuery as jest.MockedFunction<
  typeof runAthenaQuery
>;
const runDynamoDBMock = runDynamoDBQuery as jest.MockedFunction<
  typeof runDynamoDBQuery
>;

const ATHENA_OK = {
  columns: ["n"],
  rows: [["1"]],
  count: 1,
  numericColumns: [true],
  truncated: false,
};
const DYNAMODB_OK = {
  columns: ["n"],
  rows: [["1"]],
  count: 1,
  numericColumns: [true],
};

beforeEach(() => {
  jest.clearAllMocks();
  runAthenaMock.mockResolvedValue(ATHENA_OK);
  runDynamoDBMock.mockResolvedValue(DYNAMODB_OK);
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

describe.each([
  ["s3", () => runAthenaMock, "Trino/Presto SQL"],
  ["dynamodb", () => runDynamoDBMock, "PartiQL"],
] as const)("runReadOnlyQuery on %s", (destinationType, getMock, engine) => {
  const cfg = () => cfgFor(destinationType);

  describe("rejects writes without issuing any AWS call", () => {
    it.each(REJECTED)("rejects %s", async (_label, sql) => {
      await expect(runReadOnlyQuery(cfg(), sql)).rejects.toThrow();
      // THE assertion: the runner was never reached, so nothing hit the network.
      expect(getMock()).not.toHaveBeenCalled();
      expect(resolveCredentials).not.toHaveBeenCalled();
    });
  });

  describe("accepts and forwards read-only queries", () => {
    it.each(ACCEPTED)("accepts %s", async (_label, sql) => {
      const result = await runReadOnlyQuery(cfg(), sql);
      expect(getMock()).toHaveBeenCalledTimes(1);
      expect(result.engine).toBe(engine);
    });
  });
});

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

describe("DynamoDB truncation", () => {
  it("reports truncated=true when the row count reaches the cap", async () => {
    const capped = {
      columns: ["n"],
      rows: Array.from({ length: MAX_ROWS }, (_, i) => [String(i)]),
      count: MAX_ROWS,
      numericColumns: [true],
    };
    runDynamoDBMock.mockResolvedValueOnce(capped);
    const result = await runReadOnlyQuery(
      cfgFor("dynamodb"),
      "SELECT * FROM t",
    );
    expect(result.truncated).toBe(true);
    expect(result.count).toBe(MAX_ROWS);
  });

  it("reports truncated=false for a small result", async () => {
    const result = await runReadOnlyQuery(
      cfgFor("dynamodb"),
      "SELECT * FROM t",
    );
    expect(result.truncated).toBe(false);
  });
});

describe("unsupported destination", () => {
  it("throws naming the type, without any AWS call", async () => {
    await expect(
      runReadOnlyQuery(cfgFor("aurora"), "SELECT 1"),
    ).rejects.toThrow(/aurora/);
    expect(runAthenaMock).not.toHaveBeenCalled();
    expect(runDynamoDBMock).not.toHaveBeenCalled();
  });
});
