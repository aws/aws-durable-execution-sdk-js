/**
 * SQL-injection tests for the structured tools (`get_execution`,
 * `list_executions`).
 *
 * These prove the mitigation on the ACTUAL generated SQL, not merely that no
 * error was thrown. The core runners are mocked so the exact query string built
 * by this package is captured and asserted on:
 *   - Athena     -> `runAthenaQuery`'s     `query`
 *   - DynamoDB   -> `runDynamoDBQuery`'s   `statement`
 *   - Aurora     -> `runAuroraQuery`'s     `sql`
 *   - Redshift   -> `runRedshiftQuery`'s   `sql`
 *   - OpenSearch -> `runOpenSearchQuery`'s `sql`
 *
 * `assertReadOnly` is deliberately NOT mocked (it runs for real inside
 * `runReadOnlyQuery`) — but it is the BACKSTOP, not the sanitizer: an injected
 * `' OR '1'='1` is a valid SELECT it allows. The point of these tests is that a
 * tautology is never BUILT in the first place, which is this package's job.
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
} from "@aws/durable-insight-core";
import { runGetExecution, runListExecutions } from "./tools";
import { escapeSqlString } from "./sqlSafe";

jest.mock("@aws/durable-insight-core", () => {
  const actual = jest.requireActual<typeof import("@aws/durable-insight-core")>(
    "@aws/durable-insight-core",
  );
  return {
    ...actual,
    // Real: assertReadOnly, configFromWireSettings, buildSystemPrompt, ...
    // Stubbed: the runners (capture SQL, never hit the network) + credentials.
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

const EMPTY_ATHENA = {
  columns: [],
  rows: [],
  count: 0,
  numericColumns: [],
  truncated: false,
};
const EMPTY_PLAIN = {
  columns: [],
  rows: [],
  count: 0,
  numericColumns: [],
  // `hasMore` is DynamoDB-only; false keeps these fixtures complete-by-default so a
  // test that cares about incompleteness has to say so.
  hasMore: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  runAthenaMock.mockResolvedValue(EMPTY_ATHENA);
  runDynamoDBMock.mockResolvedValue(EMPTY_PLAIN);
  runAuroraMock.mockResolvedValue(EMPTY_PLAIN);
  runRedshiftMock.mockResolvedValue(EMPTY_PLAIN);
  runOpenSearchMock.mockResolvedValue(EMPTY_PLAIN);
});

function cfgFor(destinationType: string): InsightConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    dynamodbTableName: "workflow_insight",
    athenaDatabase: "insight_db",
    athenaOutputLocation: "s3://results-bucket/athena/",
    auroraResourceArn: "arn:aws:rds:us-east-1:111:cluster:c1",
    auroraSecretArn: "arn:aws:secretsmanager:us-east-1:111:secret:s1",
    redshiftWorkgroupName: "wg1",
    opensearchEndpoint: "https://os.example.com",
  });
}

/** The SQL string the runner was handed, per engine. */
function athenaSql(): string {
  expect(runAthenaMock).toHaveBeenCalledTimes(1);
  return runAthenaMock.mock.calls[0][0].query;
}
function dynamoSql(): string {
  expect(runDynamoDBMock).toHaveBeenCalledTimes(1);
  return runDynamoDBMock.mock.calls[0][0].statement;
}
function auroraSql(): string {
  expect(runAuroraMock).toHaveBeenCalledTimes(1);
  return runAuroraMock.mock.calls[0][0].sql;
}
function redshiftSql(): string {
  expect(runRedshiftMock).toHaveBeenCalledTimes(1);
  return runRedshiftMock.mock.calls[0][0].sql;
}
function openSearchSql(): string {
  expect(runOpenSearchMock).toHaveBeenCalledTimes(1);
  return runOpenSearchMock.mock.calls[0][0].sql;
}

/** Assert NONE of the five runners were invoked. */
function expectNoRunnerCalled(): void {
  expect(runAthenaMock).not.toHaveBeenCalled();
  expect(runDynamoDBMock).not.toHaveBeenCalled();
  expect(runAuroraMock).not.toHaveBeenCalled();
  expect(runRedshiftMock).not.toHaveBeenCalled();
  expect(runOpenSearchMock).not.toHaveBeenCalled();
}

/**
 * Blank the CONTENTS of single-quoted string literals (treating `''` as an
 * escaped quote), leaving the surrounding SQL. Used to prove a keyword/`;` that
 * appears in the query survives ONLY inside a literal, never as executable SQL.
 */
function outsideLiterals(sql: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          i++; // escaped quote — stay in string
          continue;
        }
        inStr = false;
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    out += ch;
  }
  return out;
}

const TAUTOLOGY = "x' OR '1'='1";
const DROP = "x'; DROP TABLE t; --";

/**
 * Per-engine facts the injection assertions parametrize over: the SQL getter,
 * the execution-id column (get_execution), and the functionName column
 * (list_executions). These differ per dialect and are sourced from schema.ts.
 */
const ENGINES = [
  ["s3", athenaSql, "executionarn", "functionname"],
  ["dynamodb", dynamoSql, "pk", "functionName"],
  ["aurora", auroraSql, "execution_arn", "function_name"],
  ["redshift", redshiftSql, "execution_arn", "function_name"],
  ["opensearch", openSearchSql, "executionArn", "functionName"],
] as const;

// ── get_execution ────────────────────────────────────────────────────────────

describe("get_execution — id injection", () => {
  describe.each(ENGINES)("%s", (dest, sqlOf, idCol) => {
    it("escapes a tautology id to a single equality against the literal", async () => {
      await runGetExecution(cfgFor(dest), { executionArn: TAUTOLOGY });
      const sql = sqlOf();
      // The value survives ONLY as an escaped literal — quotes doubled.
      expect(sql).toContain(`${idCol} = 'x'' OR ''1''=''1'`);
      // ...and NOT as a boolean tautology. If escaping were removed the SQL
      // would contain `'1'='1'` and this assertion (and the one above) fail.
      expect(sql).not.toMatch(/'1'\s*=\s*'1'/);
      // Exactly one equality predicate against the id column — no injected OR.
      expect(outsideLiterals(sql)).not.toMatch(/\bOR\b/i);
    });

    it("keeps a DROP-carrying id a single SELECT with no surviving DROP statement", async () => {
      await runGetExecution(cfgFor(dest), { executionArn: DROP });
      const sql = sqlOf();
      // Whole payload contained in one escaped literal.
      expect(sql).toContain(`${idCol} = 'x''; DROP TABLE t; --'`);
      const code = outsideLiterals(sql);
      expect(code).not.toMatch(/\bDROP\b/i); // no DROP outside the literal
      expect(code).not.toContain(";"); // no second statement
      expect(code.trimStart()).toMatch(/^SELECT\b/i); // still one SELECT
    });
  });
});

describe("get_execution — Athena partition-value injection", () => {
  it("rejects a non-numeric year and never reaches the runner", async () => {
    await expect(
      runGetExecution(cfgFor("s3"), { executionArn: "arn", year: TAUTOLOGY }),
    ).rejects.toThrow(/year/i);
    expect(runAthenaMock).not.toHaveBeenCalled();
  });

  it("rejects a DROP-carrying month and never reaches the runner", async () => {
    await expect(
      runGetExecution(cfgFor("s3"), { executionArn: "arn", month: DROP }),
    ).rejects.toThrow(/month/i);
    expect(runAthenaMock).not.toHaveBeenCalled();
  });

  it("interpolates validated numeric partitions as a pruning predicate", async () => {
    await runGetExecution(cfgFor("s3"), {
      executionArn: "arn",
      year: "2024",
      month: "01",
      day: "31",
    });
    const sql = athenaSql();
    expect(sql).toContain("year = '2024' AND month = '01' AND day = '31' AND");
    expect(sql).toContain("executionarn = 'arn' LIMIT 1");
  });
});

// ── list_executions ──────────────────────────────────────────────────────────

describe("list_executions — filter injection", () => {
  describe.each(ENGINES)("%s", (dest, sqlOf, _idCol, fnCol) => {
    it("rejects an injected status (closed enum) before any runner call", async () => {
      await expect(
        runListExecutions(cfgFor(dest), { status: TAUTOLOGY }),
      ).rejects.toThrow(/status/i);
      expectNoRunnerCalled();
    });

    it("escapes an injected functionName to a single equality, not a tautology", async () => {
      await runListExecutions(cfgFor(dest), { functionName: TAUTOLOGY });
      const sql = sqlOf();
      expect(sql).toContain(`${fnCol} = 'x'' OR ''1''=''1'`);
      expect(sql).not.toMatch(/'1'\s*=\s*'1'/);
      // The only OR-free, single-statement SELECT is what we want.
      const code = outsideLiterals(sql);
      expect(code).not.toMatch(/\bOR\b/i);
      expect(code.trimStart()).toMatch(/^SELECT\b/i);
    });

    it("keeps a DROP-carrying functionName a single SELECT with no surviving DROP", async () => {
      await runListExecutions(cfgFor(dest), { functionName: DROP });
      const sql = sqlOf();
      expect(sql).toContain(`${fnCol} = 'x''; DROP TABLE t; --'`);
      const code = outsideLiterals(sql);
      expect(code).not.toMatch(/\bDROP\b/i);
      expect(code).not.toContain(";");
      expect(code.trimStart()).toMatch(/^SELECT\b/i);
    });

    it("rejects a malformed since timestamp before any runner call", async () => {
      await expect(
        runListExecutions(cfgFor(dest), { since: TAUTOLOGY }),
      ).rejects.toThrow(/since/i);
      expectNoRunnerCalled();
    });
  });
});

describe("list_executions — validated filters build the expected per-dialect SQL", () => {
  it("s3: lowercase columns, recordtype guard, ORDER BY + LIMIT", async () => {
    await runListExecutions(cfgFor("s3"), {
      status: "FAILED",
      since: "2024-01-01",
      until: "2024-02-01T00:00:00Z",
      functionName: "my-fn",
    });
    const sql = athenaSql();
    expect(sql).toContain("recordtype = 'WorkflowInsight'");
    expect(sql).toContain("status = 'FAILED'");
    expect(sql).toContain("functionname = 'my-fn'");
    expect(sql).toContain("starttime >= '2024-01-01'");
    expect(sql).toContain("starttime <= '2024-02-01T00:00:00Z'");
    expect(sql).toMatch(/ORDER BY starttime DESC LIMIT 100$/);
  });

  it("dynamodb: camelCase columns, recordType guard, no ORDER BY / LIMIT", async () => {
    await runListExecutions(cfgFor("dynamodb"), { status: "SUCCEEDED" });
    const sql = dynamoSql();
    expect(sql).toContain('FROM "workflow_insight"');
    expect(sql).toContain("recordType = 'WorkflowInsight'");
    expect(sql).toContain("status = 'SUCCEEDED'");
    expect(sql).not.toMatch(/\bLIMIT\b/i);
    expect(sql).not.toMatch(/\bORDER BY\b/i);
  });

  it("aurora: snake_case columns, NO recordType guard, ORDER BY + LIMIT", async () => {
    await runListExecutions(cfgFor("aurora"), {
      status: "FAILED",
      functionName: "my-fn",
      since: "2024-01-01",
    });
    const sql = auroraSql();
    // Aurora's dedicated table has no recordType column — the guard MUST be
    // absent, else it would be a "column does not exist" error.
    expect(sql).not.toMatch(/recordtype/i);
    expect(sql).toContain("FROM workflow_insight");
    expect(sql).toContain("status = 'FAILED'");
    expect(sql).toContain("function_name = 'my-fn'");
    expect(sql).toContain("start_time >= '2024-01-01'");
    expect(sql).toMatch(/ORDER BY start_time DESC LIMIT 100$/);
  });

  it("aurora: no filters yields a bare SELECT with no WHERE clause", async () => {
    await runListExecutions(cfgFor("aurora"), {});
    const sql = auroraSql();
    expect(sql).not.toMatch(/\bWHERE\b/i);
    expect(sql).toMatch(/ORDER BY start_time DESC LIMIT 100$/);
  });

  it("redshift: snake_case columns, NO recordType guard, ORDER BY + LIMIT", async () => {
    await runListExecutions(cfgFor("redshift"), { status: "RUNNING" });
    const sql = redshiftSql();
    expect(sql).not.toMatch(/recordtype/i);
    expect(sql).toContain("FROM workflow_insight");
    expect(sql).toContain("status = 'RUNNING'");
    expect(sql).toMatch(/ORDER BY start_time DESC LIMIT 100$/);
  });

  it("opensearch: camelCase columns, backtick-quoted index, recordType guard, ORDER BY startTime", async () => {
    await runListExecutions(cfgFor("opensearch"), {
      status: "SUCCEEDED",
      functionName: "my-fn",
    });
    const sql = openSearchSql();
    // Index name has a hyphen -> MUST be backtick-quoted.
    expect(sql).toContain("FROM `workflow-insight`");
    expect(sql).toContain("recordType = 'WorkflowInsight'");
    expect(sql).toContain("status = 'SUCCEEDED'");
    expect(sql).toContain("functionName = 'my-fn'");
    // startTime is a DATE field, so ORDER BY on it is allowed by the SQL plugin.
    expect(sql).toMatch(/ORDER BY startTime DESC LIMIT 100$/);
  });
});

/**
 * A trailing backslash must be rejected rather than escaped.
 *
 * THE FAILURE THIS PREVENTS:
 * `escapeSqlString` doubled single quotes only. On Redshift that is incomplete:
 * backslash is an escape character in its string literals (its own `QUOTE_LITERAL`
 * doubles backslashes as well as quotes), so a value ending in `\` produces `'foo\'`
 * where the doubled closing quote is itself escaped and the literal runs on into the
 * surrounding SQL. The log path already had this closed via core's
 * `escapeQuotedString`; the SQL path did not.
 *
 * WHY REJECTION AND NOT ESCAPING:
 * Doubling backslashes would be correct for Redshift and WRONG for Athena/Trino,
 * where a backslash is an ordinary character -- there, doubling turns a search for
 * `foo\` into a search for `foo\\`. No single escaping is right for all six engines.
 * Rejection sidesteps it and loses nothing real: only execution ARNs and Lambda
 * function names reach this code, and neither can contain a backslash.
 */
describe("backslashes are rejected on the SQL path", () => {
  it.each([
    ["trailing backslash", "fn\\"],
    ["backslash before a quote", "fn\\'"],
    ["interior backslash", "a\\b"],
    ["double backslash", "fn\\\\"],
  ])("rejects a %s", (_label, value) => {
    expect(() => escapeSqlString(value)).toThrow(/backslash/i);
  });

  it("still escapes quotes in values without a backslash", () => {
    // Acceptance: a check that threw for everything would satisfy the cases above
    // while breaking every legitimate value.
    expect(escapeSqlString("O'Brien")).toBe("O''Brien");
    expect(escapeSqlString("plain-name")).toBe("plain-name");
    expect(escapeSqlString("")).toBe("");
  });

  it("names the offending value so a caller can see what was wrong", () => {
    expect(() => escapeSqlString("bad\\name")).toThrow(/bad\\\\name/);
  });

  it("rejects at the tool boundary, before any query is built", async () => {
    // The unit above proves the helper throws; this proves the throw reaches the
    // caller instead of being swallowed into a malformed query.
    await expect(
      runListExecutions(cfgFor("redshift"), { functionName: "fn\\" }),
    ).rejects.toThrow(/backslash/i);
  });
});
