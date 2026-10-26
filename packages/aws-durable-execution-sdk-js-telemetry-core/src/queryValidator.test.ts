import { assertReadOnly, type SqlEngine } from "./queryValidator";

const ok = (q: string) =>
  expect(() => assertReadOnly(q, "PostgreSQL")).not.toThrow();
const rejected = (q: string) =>
  expect(() => assertReadOnly(q, "PostgreSQL")).toThrow();

describe("assertReadOnly: allows legitimate read-only queries", () => {
  it("plain SELECT", () =>
    ok("SELECT executionArn FROM durable_execution_telemetry"));
  it("SELECT * with WHERE", () =>
    ok("SELECT * FROM durable_execution_telemetry WHERE status = 'FAILED'"));
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
    rejected("WITH x AS (SELECT 1) DELETE FROM durable_execution_telemetry"));
  it("write inside the CTE body", () =>
    rejected(
      "WITH d AS (DELETE FROM durable_execution_telemetry RETURNING *) SELECT * FROM d",
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
  it("SELECT ... INTO, which creates a table", () =>
    rejected("SELECT * INTO copy_of_t FROM t"));
});

// Each query below is read by the database differently from a scanner that
// only knows '...', "...", -- and /* */. The scanner would blank the DELETE as
// string or comment content while the database runs it.
describe("assertReadOnly: rejects lexing differences that hide a write", () => {
  // Match the refusal message, so an unrelated error (for example a TypeError)
  // cannot make a rejection test pass.
  const forEngine = (engine: SqlEngine) => ({
    ok: (q: string) => expect(() => assertReadOnly(q, engine)).not.toThrow(),
    rejected: (q: string) =>
      expect(() => assertReadOnly(q, engine)).toThrow(
        `Refused to execute ${engine} query`,
      ),
  });
  const pg = forEngine("PostgreSQL");
  const redshift = forEngine("Redshift SQL");
  const opensearch = forEngine("OpenSearch SQL");
  const athena = forEngine("Trino/Presto SQL");
  const partiql = forEngine("PartiQL");

  it("PostgreSQL dollar-quoting hides a second statement", () =>
    pg.rejected("SELECT $$'$$; DELETE FROM t; --'"));
  it("tagged dollar-quoting hides a second statement", () =>
    pg.rejected("SELECT $x$'$x$; DELETE FROM t; --'"));
  it("dollar-quoting hides a data-modifying CTE", () =>
    pg.rejected(
      "WITH a AS (SELECT $$'$$ AS q), d AS (DELETE FROM t RETURNING 1) SELECT * FROM a --'",
    ));
  it("dollar-quoting is rejected on every engine", () => {
    for (const e of [redshift, opensearch, athena, partiql])
      e.rejected("SELECT $$'$$; DELETE FROM t; --'");
  });
  it("a PostgreSQL E'' escape string hides a second statement", () =>
    pg.rejected("SELECT E'\\''; DELETE FROM t; --'"));
  it("a Redshift backslash escape hides a second statement", () =>
    redshift.rejected("SELECT '\\''; DELETE FROM t; --'"));
  it("an OpenSearch backslash escape hides a second statement", () =>
    opensearch.rejected("SELECT '\\''; DELETE FROM t; --'"));
  it("a backslash in a double-quoted literal is rejected", () =>
    opensearch.rejected('SELECT "\\""; DELETE FROM t; --"'));
  it("PostgreSQL nested block comments hide a second statement", () =>
    pg.rejected("SELECT 1 /* /* */ '*/ ; DELETE FROM t; --'"));
  it("a carriage return ends a PostgreSQL line comment", () =>
    pg.rejected("SELECT 1 --\r; DELETE FROM t"));
  it("a MySQL-style # comment hides a quote on OpenSearch", () =>
    opensearch.rejected("SELECT 1 # '\n; DELETE FROM t; -- '"));
  it("a quote inside a backtick identifier does not open a string", () =>
    opensearch.rejected("SELECT `'`; DELETE FROM t; -- '"));
  it("OpenSearch: a backtick-quoted index name is allowed", () =>
    opensearch.ok("SELECT * FROM `durable-execution-telemetry` LIMIT 5"));
  it("OpenSearch: any -- comment is rejected, because an identifier can contain --", () =>
    opensearch.rejected("SELECT abc-- '\n'; DELETE FROM t; -- '"));
  it("PostgreSQL: a -- comment with no space after it is allowed", () =>
    pg.ok("SELECT 1 --comment\nFROM t"));
  it("PartiQL: a backtick (Ion literal) is rejected", () =>
    partiql.rejected("SELECT * FROM t WHERE a = `1`"));
  it("an unterminated string is rejected", () =>
    pg.rejected("SELECT 'abc FROM t"));
  it("an unterminated block comment is rejected", () =>
    pg.rejected("SELECT 1 /* never closed"));

  it("Athena: a backslash inside a literal is an ordinary character", () =>
    athena.ok("SELECT * FROM t WHERE regexp_like(functionname, '\\d+')"));
  it("PartiQL: a backslash inside a literal is an ordinary character", () =>
    partiql.ok("SELECT * FROM t WHERE pk = 'a\\b'"));
  it("PostgreSQL: the #>> JSON operator is allowed", () =>
    pg.ok("SELECT record_json #>> '{error,message}' FROM t"));
  it("Athena: the $path hidden column in double quotes is allowed", () =>
    athena.ok('SELECT "$path" FROM t'));
  it("a line comment followed by more SQL is allowed", () =>
    pg.ok("SELECT 1 -- note\nFROM t"));
});
