import {
  isAggregateQuery,
  ensureIdentifierColumn,
  resolveActualColumnCasing,
  resolveActualColumns,
} from "./queryShape";

describe("isAggregateQuery", () => {
  it("detects COUNT(*) as aggregate", () => {
    expect(isAggregateQuery("SELECT COUNT(*) FROM t", "sql")).toBe(true);
  });

  it("detects GROUP BY as aggregate", () => {
    expect(
      isAggregateQuery(
        "SELECT status, COUNT(*) AS ct FROM t GROUP BY status",
        "sql",
      ),
    ).toBe(true);
  });

  it("detects bare SUM/AVG/MIN/MAX without GROUP BY as aggregate", () => {
    expect(isAggregateQuery("SELECT SUM(durationMs) FROM t", "sql")).toBe(true);
    expect(isAggregateQuery("SELECT AVG(durationMs) FROM t", "sql")).toBe(true);
    expect(isAggregateQuery("SELECT MIN(durationMs) FROM t", "sql")).toBe(true);
    expect(isAggregateQuery("SELECT MAX(durationMs) FROM t", "sql")).toBe(true);
  });

  it("does not flag a plain row-level SELECT", () => {
    expect(
      isAggregateQuery("SELECT executionArn, status FROM t LIMIT 10", "sql"),
    ).toBe(false);
  });

  it("detects Logs Insights 'stats' as aggregate", () => {
    expect(
      isAggregateQuery(
        'filter status = "FAILED" | stats count(*) as ct',
        "logs-insights",
      ),
    ).toBe(true);
  });

  it("does not flag a plain Logs Insights query without stats", () => {
    expect(
      isAggregateQuery(
        'filter status = "FAILED" | fields @timestamp, executionArn | limit 50',
        "logs-insights",
      ),
    ).toBe(false);
  });
});

describe("ensureIdentifierColumn: aggregate/set-operator bail-out", () => {
  it("does not inject into an aggregate query", () => {
    const result = ensureIdentifierColumn(
      "SELECT COUNT(*) FROM t",
      "executionArn",
      "sql",
    );
    expect(result).toEqual({ query: "SELECT COUNT(*) FROM t" });
  });

  it("does not inject into a GROUP BY query even with other columns selected", () => {
    const result = ensureIdentifierColumn(
      "SELECT function_name, AVG(duration_ms) AS avg_ms FROM t GROUP BY function_name",
      "execution_arn",
      "sql",
    );
    expect(result).toEqual({
      query:
        "SELECT function_name, AVG(duration_ms) AS avg_ms FROM t GROUP BY function_name",
    });
  });

  it("does not inject into a SELECT DISTINCT (a unique id would break distinctness)", () => {
    const query = "SELECT DISTINCT functionName FROM t";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    expect(result).toEqual({ query });
  });

  it("does not inject into a SELECT DISTINCT with extra columns", () => {
    const query = "SELECT DISTINCT status, functionName FROM t ORDER BY status";
    const result = ensureIdentifierColumn(query, "executionArn", "sql", [
      "year",
      "month",
      "day",
    ]);
    expect(result).toEqual({ query });
  });

  it("does not inject into a top-level UNION (would corrupt column counts across branches)", () => {
    const query = "SELECT a FROM t UNION SELECT b FROM t";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    expect(result).toEqual({ query });
  });

  it("does not inject into a top-level UNION ALL", () => {
    const query =
      "SELECT executionArn FROM t WHERE status='FAILED' UNION ALL SELECT executionArn FROM t WHERE status='SUCCEEDED'";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    expect(result).toEqual({ query });
  });

  it("does not inject into a top-level INTERSECT", () => {
    const query =
      "SELECT executionArn FROM t INTERSECT SELECT executionArn FROM t2";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    expect(result).toEqual({ query });
  });

  it("does not inject into a top-level EXCEPT", () => {
    const query =
      "SELECT executionArn FROM t EXCEPT SELECT executionArn FROM t2";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    expect(result).toEqual({ query });
  });

  it("does not false-positive on a string literal containing 'union'", () => {
    const query =
      "SELECT executionArn, status FROM t WHERE functionName = 'union-processor' LIMIT 10";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    // executionArn is already present, so nothing should be injected at all,
    // and the query must come back byte-for-byte unchanged (no corruption
    // from misreading "union" inside the string literal as a set operator).
    expect(result.query).toBe(query);
    expect(result.idColumn).toBe("executionArn");
    expect(result.injectedColumns).toEqual([]);
  });

  it("a UNION strictly inside a subquery does not block injection into the outer query", () => {
    const query =
      "SELECT status, val FROM (SELECT status, val FROM t WHERE a=1 UNION ALL SELECT status, val FROM t WHERE a=2) x LIMIT 10";
    const result = ensureIdentifierColumn(query, "executionArn", "sql");
    expect(result.query).toBe(
      "SELECT status, val, executionArn FROM (SELECT status, val FROM t WHERE a=1 UNION ALL SELECT status, val FROM t WHERE a=2) x LIMIT 10",
    );
    expect(result.idColumn).toBe("executionArn");
    expect(result.injectedColumns).toEqual(["executionArn"]);
  });
});

describe("ensureIdentifierColumn: SQL injection", () => {
  it("injects a missing identifier column", () => {
    const result = ensureIdentifierColumn(
      "SELECT functionName, status, emittedAt FROM workflow_insight LIMIT 10",
      "executionarn",
      "sql",
    );
    expect(result).toEqual({
      query:
        "SELECT functionName, status, emittedAt, executionarn FROM workflow_insight LIMIT 10",
      idColumn: "executionarn",
      extraColumns: [],
      injectedColumns: ["executionarn"],
    });
  });

  it("does not duplicate an identifier already present under a different case (SQL identifiers are case-insensitive)", () => {
    const result = ensureIdentifierColumn(
      "SELECT executionArn, functionName, status, emittedAt FROM workflow_insight LIMIT 10",
      "executionarn",
      "sql",
    );
    expect(result).toEqual({
      query:
        "SELECT executionArn, functionName, status, emittedAt FROM workflow_insight LIMIT 10",
      idColumn: "executionarn",
      extraColumns: [],
      injectedColumns: [],
    });
  });

  it("SELECT * already includes everything — no injection needed", () => {
    const result = ensureIdentifierColumn(
      "SELECT * FROM t WHERE status = 'FAILED'",
      "pk",
      "sql",
    );
    expect(result).toEqual({
      query: "SELECT * FROM t WHERE status = 'FAILED'",
      idColumn: "pk",
      extraColumns: [],
      injectedColumns: [],
    });
  });

  it("injects into the outer/final SELECT of a WITH-CTE query, not the CTE's inner one", () => {
    const result = ensureIdentifierColumn(
      "WITH recent AS (SELECT * FROM t) SELECT status, functionName FROM recent LIMIT 10",
      "executionArn",
      "sql",
    );
    expect(result).toEqual({
      query:
        "WITH recent AS (SELECT * FROM t) SELECT status, functionName, executionArn FROM recent LIMIT 10",
      idColumn: "executionArn",
      extraColumns: [],
      injectedColumns: ["executionArn"],
    });
  });

  it("injects multiple extraColumns alongside idColumn (S3+Athena's year/month/day case)", () => {
    const result = ensureIdentifierColumn(
      "SELECT functionName, status FROM t LIMIT 10",
      "executionarn",
      "sql",
      ["year", "month", "day"],
    );
    expect(result.query).toBe(
      "SELECT functionName, status, executionarn, year, month, day FROM t LIMIT 10",
    );
    expect(result.injectedColumns).toEqual([
      "executionarn",
      "year",
      "month",
      "day",
    ]);
  });

  it("does not report a column as injected if the user's own query already selected it", () => {
    const result = ensureIdentifierColumn(
      "SELECT functionName, year FROM t LIMIT 10",
      "executionarn",
      "sql",
      ["year", "month", "day"],
    );
    // year is already present (user asked for it) — only executionarn/month/day are injected.
    expect(result.injectedColumns).toEqual(["executionarn", "month", "day"]);
    // year appears exactly once in the resulting query (not duplicated).
    expect(result.query.match(/\byear\b/gi)).toHaveLength(1);
  });
});

describe("ensureIdentifierColumn: Logs Insights injection", () => {
  it("no 'fields' command means every field is already included — nothing to inject", () => {
    const result = ensureIdentifierColumn(
      'filter status = "FAILED" | sort @timestamp desc | limit 50',
      "executionArn",
      "logs-insights",
    );
    expect(result).toEqual({
      query: 'filter status = "FAILED" | sort @timestamp desc | limit 50',
      idColumn: "executionArn",
      extraColumns: [],
      injectedColumns: [],
    });
  });

  it("injects into an existing 'fields' command's field list", () => {
    const result = ensureIdentifierColumn(
      'filter status = "FAILED" | fields @timestamp, functionName | sort @timestamp desc | limit 50',
      "executionArn",
      "logs-insights",
    );
    expect(result.query).toBe(
      'filter status = "FAILED" | fields @timestamp, functionName, executionArn | sort @timestamp desc | limit 50',
    );
    expect(result.injectedColumns).toEqual(["executionArn"]);
  });

  it("does not duplicate an identifier already in the 'fields' list", () => {
    const result = ensureIdentifierColumn(
      'filter status = "FAILED" | fields @timestamp, executionArn | limit 50',
      "executionArn",
      "logs-insights",
    );
    expect(result.query).toBe(
      'filter status = "FAILED" | fields @timestamp, executionArn | limit 50',
    );
    expect(result.injectedColumns).toEqual([]);
  });

  it("does not inject into a 'stats' aggregate query", () => {
    const query =
      'filter recordType = "WorkflowInsight" | stats count(*) as ct by status';
    const result = ensureIdentifierColumn(
      query,
      "executionArn",
      "logs-insights",
    );
    expect(result).toEqual({ query });
  });
});

describe("resolveActualColumnCasing", () => {
  it("resolves a requested column to its actual casing in the result set", () => {
    expect(
      resolveActualColumnCasing("executionarn", [
        "executionArn",
        "functionName",
        "status",
      ]),
    ).toBe("executionArn");
  });

  it("returns undefined when the column genuinely isn't present", () => {
    expect(
      resolveActualColumnCasing("executionarn", ["status", "functionName"]),
    ).toBeUndefined();
  });

  it("returns undefined when idColumn itself is undefined", () => {
    expect(resolveActualColumnCasing(undefined, ["status"])).toBeUndefined();
  });
});

describe("resolveActualColumns", () => {
  it("resolves each requested column to its actual casing, dropping ones not present", () => {
    expect(
      resolveActualColumns(
        ["year", "month", "day", "notpresent"],
        ["executionArn", "year", "month", "day"],
      ),
    ).toEqual(["year", "month", "day"]);
  });

  it("returns an empty array for an empty or undefined input", () => {
    expect(resolveActualColumns([], ["a", "b"])).toEqual([]);
    expect(resolveActualColumns(undefined, ["a", "b"])).toEqual([]);
  });
});
