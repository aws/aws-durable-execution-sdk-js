/**
 * SQL-injection tests for the structured tools (`get_execution`,
 * `list_executions`).
 *
 * These prove the mitigation on the ACTUAL generated SQL, not merely that no
 * error was thrown. The core runners are mocked so the exact query string built
 * by this package is captured and asserted on:
 *   - Athena  -> `runAthenaQuery`'s   `query`
 *   - DynamoDB -> `runDynamoDBQuery`'s `statement`
 *
 * `assertReadOnly` is deliberately NOT mocked (it runs for real inside
 * `runReadOnlyQuery`) — but it is the BACKSTOP, not the sanitizer: an injected
 * `' OR '1'='1` is a valid SELECT it allows. The point of these tests is that a
 * tautology is never BUILT in the first place, which is this package's job.
 */
import {
  configFromWireSettings,
  runAthenaQuery,
  runDynamoDBQuery,
  resolveCredentials,
  type InsightConfig,
} from "durable-insight-core";
import { runGetExecution, runListExecutions } from "./tools";

jest.mock("durable-insight-core", () => {
  const actual = jest.requireActual<typeof import("durable-insight-core")>(
    "durable-insight-core",
  );
  return {
    ...actual,
    // Real: assertReadOnly, configFromWireSettings, buildSystemPrompt, ...
    // Stubbed: the runners (capture SQL, never hit the network) + credentials.
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

const EMPTY_ATHENA = {
  columns: [],
  rows: [],
  count: 0,
  numericColumns: [],
  truncated: false,
};
const EMPTY_DYNAMODB = { columns: [], rows: [], count: 0, numericColumns: [] };

beforeEach(() => {
  jest.clearAllMocks();
  runAthenaMock.mockResolvedValue(EMPTY_ATHENA);
  runDynamoDBMock.mockResolvedValue(EMPTY_DYNAMODB);
});

function cfgFor(destinationType: string): InsightConfig {
  return configFromWireSettings({
    destinationType,
    region: "us-east-1",
    dynamodbTableName: "workflow_insight",
    athenaDatabase: "insight_db",
    athenaOutputLocation: "s3://results-bucket/athena/",
  });
}

/** The SQL string the runner was handed (Athena `query` / DynamoDB `statement`). */
function athenaSql(): string {
  expect(runAthenaMock).toHaveBeenCalledTimes(1);
  return runAthenaMock.mock.calls[0][0].query;
}
function dynamoSql(): string {
  expect(runDynamoDBMock).toHaveBeenCalledTimes(1);
  return runDynamoDBMock.mock.calls[0][0].statement;
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

// ── get_execution ────────────────────────────────────────────────────────────

describe("get_execution — id injection", () => {
  describe.each(["s3", "dynamodb"] as const)("%s", (dest) => {
    const sqlOf = dest === "s3" ? athenaSql : dynamoSql;
    const idCol = dest === "s3" ? "executionarn" : "pk";

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
  describe.each([
    ["s3", athenaSql, "functionname"] as const,
    ["dynamodb", dynamoSql, "functionName"] as const,
  ])("%s", (dest, sqlOf, fnCol) => {
    it("rejects an injected status (closed enum) before any runner call", async () => {
      await expect(
        runListExecutions(cfgFor(dest), { status: TAUTOLOGY }),
      ).rejects.toThrow(/status/i);
      expect(runAthenaMock).not.toHaveBeenCalled();
      expect(runDynamoDBMock).not.toHaveBeenCalled();
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
      expect(runAthenaMock).not.toHaveBeenCalled();
      expect(runDynamoDBMock).not.toHaveBeenCalled();
    });
  });
});

describe("list_executions — validated filters build the expected SQL", () => {
  it("s3: interpolates a validated status and ISO bounds as literals", async () => {
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

  it("dynamodb: builds a PartiQL SELECT with no ORDER BY / LIMIT", async () => {
    await runListExecutions(cfgFor("dynamodb"), { status: "SUCCEEDED" });
    const sql = dynamoSql();
    expect(sql).toContain('FROM "workflow_insight"');
    expect(sql).toContain("recordType = 'WorkflowInsight'");
    expect(sql).toContain("status = 'SUCCEEDED'");
    expect(sql).not.toMatch(/\bLIMIT\b/i);
    expect(sql).not.toMatch(/\bORDER BY\b/i);
  });
});
