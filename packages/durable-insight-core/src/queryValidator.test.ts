import { assertReadOnly } from "./queryValidator";

const ok = (q: string) =>
  expect(() => assertReadOnly(q, "PostgreSQL")).not.toThrow();
const rejected = (q: string) =>
  expect(() => assertReadOnly(q, "PostgreSQL")).toThrow();

describe("assertReadOnly: allows legitimate read-only queries", () => {
  it("plain SELECT", () => ok("SELECT executionArn FROM workflow_insight"));
  it("SELECT * with WHERE", () =>
    ok("SELECT * FROM workflow_insight WHERE status = 'FAILED'"));
  it("a real (read-only) CTE", () =>
    ok(
      "WITH failed AS (SELECT executionArn FROM t WHERE status = 'FAILED') SELECT * FROM failed",
    ));
  it("the REPLACE() scalar function (not a REPLACE statement)", () =>
    ok("SELECT replace(functionName, 'prod-', '') FROM t"));
  it("REPLACE() with a space before the paren", () =>
    ok("SELECT REPLACE (functionName, 'a', 'b') FROM t"));
  it("column names that merely contain keywords", () =>
    ok("SELECT deleted_at, created_at, updated_at FROM t"));
  it("a keyword only inside a string literal", () =>
    ok("SELECT * FROM t WHERE status = 'DELETED'"));
  it("a keyword only inside a line comment", () =>
    ok("SELECT executionArn FROM t -- delete old ones later\n"));
  it("a keyword only inside a block comment", () =>
    ok("SELECT executionArn /* drop this someday */ FROM t"));
  it("a trailing semicolon", () => ok("SELECT * FROM t;"));
  it("a quoted identifier that looks like a keyword", () =>
    ok('SELECT "delete" FROM t'));
});

describe("assertReadOnly: rejects the data-modifying CTE bypass", () => {
  it("write at top level after a CTE", () =>
    rejected("WITH x AS (SELECT 1) DELETE FROM workflow_insight"));
  it("write inside the CTE body", () =>
    rejected(
      "WITH d AS (DELETE FROM workflow_insight RETURNING *) SELECT * FROM d",
    ));
  it("UPDATE inside a CTE", () =>
    rejected(
      "WITH u AS (UPDATE t SET status = 'X' RETURNING *) SELECT * FROM u",
    ));
  it("INSERT inside a CTE", () =>
    rejected(
      "WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i",
    ));
});

describe("assertReadOnly: rejects obvious writes and bad shapes", () => {
  it("leading DELETE", () => rejected("DELETE FROM t"));
  it("leading DROP", () => rejected("DROP TABLE t"));
  it("leading TRUNCATE", () => rejected("TRUNCATE t"));
  it("a second DROP statement", () =>
    rejected("SELECT * FROM t; DROP TABLE t"));
  it("two SELECT statements", () =>
    rejected("SELECT * FROM t; SELECT * FROM u"));
  it("a non-SELECT/WITH start (EXPLAIN)", () =>
    rejected("EXPLAIN SELECT * FROM t"));
  it("an empty query", () => rejected("   "));
  it("a write hidden after a string literal", () =>
    rejected("SELECT * FROM t WHERE name = 'a'; DELETE FROM t"));
});
