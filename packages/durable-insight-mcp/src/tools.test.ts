/**
 * Functional tests for the structured tools' RESULT shapes (AC-3.2: every
 * result is machine-readable data, never prose). Injection/escaping is covered
 * separately in `injection.test.ts`.
 */
import {
  configFromWireSettings,
  runAthenaQuery,
  runDynamoDBQuery,
  resolveCredentials,
  type InsightConfig,
} from "durable-insight-core";
import { MAX_ROWS } from "./readOnlyQuery";
import {
  buildDescribeSchemaResult,
  runGetExecution,
  runListExecutions,
} from "./tools";

jest.mock("durable-insight-core", () => {
  const actual = jest.requireActual<typeof import("durable-insight-core")>(
    "durable-insight-core",
  );
  return {
    ...actual,
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
