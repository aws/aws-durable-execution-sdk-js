const mockSend = jest.fn();

jest.mock("@aws-sdk/client-athena", () => ({
  AthenaClient: jest.fn(() => ({ send: mockSend })),
  StartQueryExecutionCommand: jest.fn((i) => ({ __type: "start", i })),
  GetQueryExecutionCommand: jest.fn((i) => ({ __type: "getExec", i })),
  GetQueryResultsCommand: jest.fn((i) => ({ __type: "getResults", i })),
}));
jest.mock("@aws-sdk/client-glue", () => ({
  GlueClient: jest.fn(),
  GetTableCommand: jest.fn(),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCreateTableDdl,
  RECORD_CAMEL_CASE_KEYS,
  runAthenaQuery,
} from "./athena";

/** Build a GetQueryResults page. The first page carries the header row. */
function page(
  dataRows: string[][],
  withHeader: boolean,
  nextToken?: string,
  columnType = "varchar",
) {
  const rows = dataRows.map((r) => ({
    Data: r.map((v) => ({ VarCharValue: v })),
  }));
  return {
    ResultSet: {
      Rows: withHeader ? [{ Data: [{ VarCharValue: "col1" }] }, ...rows] : rows,
      ResultSetMetadata: {
        ColumnInfo: [{ Name: "col1", Type: columnType }],
      },
    },
    NextToken: nextToken,
  };
}

/** Route send() by command type; GetQueryResults returns `pages` in order. */
function wireClient(pages: ReturnType<typeof page>[]) {
  let pageIdx = 0;
  mockSend.mockImplementation((cmd: { __type: string }) => {
    if (cmd.__type === "start")
      return Promise.resolve({ QueryExecutionId: "q-1" });
    if (cmd.__type === "getExec")
      return Promise.resolve({
        QueryExecution: { Status: { State: "SUCCEEDED" } },
      });
    if (cmd.__type === "getResults")
      return Promise.resolve(pages[pageIdx++] ?? pages[pages.length - 1]);
    throw new Error(`unexpected command ${cmd.__type}`);
  });
}

const base = {
  region: "us-east-1",
  credentials: {} as never,
  database: "db",
  outputLocation: "s3://b/",
  query: "SELECT col1 FROM t",
};

beforeEach(() => mockSend.mockReset());

describe("runAthenaQuery: row cap", () => {
  it("stops paging at maxRows and marks the result truncated", async () => {
    // 5 data rows across two pages; cap at 3.
    wireClient([
      page([["a"], ["b"]], true, "next"),
      page([["c"], ["d"], ["e"]], false),
    ]);
    const res = await runAthenaQuery({ ...base, maxRows: 3 });
    expect(res.count).toBe(3);
    expect(res.rows).toEqual([["a"], ["b"], ["c"]]);
    expect(res.truncated).toBe(true);
    // It must NOT fetch a third results page after the cap is reached.
    const resultCalls = mockSend.mock.calls.filter(
      (c) => c[0].__type === "getResults",
    ).length;
    expect(resultCalls).toBe(2);
  });

  it("does not mark truncated when the result fits under the cap", async () => {
    wireClient([page([["a"], ["b"]], true)]);
    const res = await runAthenaQuery({ ...base, maxRows: 100 });
    expect(res.count).toBe(2);
    expect(res.truncated).toBe(false);
  });

  it("collects every row when no cap is given", async () => {
    wireClient([
      page([["a"], ["b"]], true, "next"),
      page([["c"], ["d"], ["e"]], false),
    ]);
    const res = await runAthenaQuery(base);
    expect(res.count).toBe(5);
    expect(res.truncated).toBe(false);
  });
});

describe("runAthenaQuery: numeric column detection", () => {
  it("flags a bigint column as numeric", async () => {
    wireClient([page([["1"], ["2"]], true, undefined, "bigint")]);
    const res = await runAthenaQuery(base);
    expect(res.numericColumns).toEqual([true]);
  });

  it("does not flag a varchar column as numeric", async () => {
    wireClient([page([["a"]], true, undefined, "varchar")]);
    const res = await runAthenaQuery(base);
    expect(res.numericColumns).toEqual([false]);
  });

  it("does not flag a timestamp column as numeric", async () => {
    wireClient([page([["2026-01-01"]], true, undefined, "timestamp")]);
    const res = await runAthenaQuery(base);
    expect(res.numericColumns).toEqual([false]);
  });
});

describe("buildCreateTableDdl: key case", () => {
  const ddl = buildCreateTableDdl({
    database: "db",
    table: "t",
    s3Location: "s3://bucket/prefix",
  });

  it("keeps key case inside input/output", () => {
    // Without this the SerDe lowercases payload keys, so $.claimId is NULL.
    expect(ddl).toContain("'case.insensitive' = 'false'");
  });

  it.each([...RECORD_CAMEL_CASE_KEYS])(
    "maps the camelCase key %s to its lowercase column",
    (key) => {
      expect(ddl).toContain(`'mapping.${key.toLowerCase()}' = '${key}'`);
    },
  );

  it("covers every lowercase column that has a camelCase record key", () => {
    // Every column or struct field whose record key has an uppercase letter
    // must be in the list, or that field would load as NULL.
    const columns = new Set(
      ddl
        .split("\n")
        .map((line) => /^([a-z]+)[ :]/.exec(line.trim())?.[1])
        .filter((c): c is string => c !== undefined),
    );
    const mapped = new Set(RECORD_CAMEL_CASE_KEYS.map((k) => k.toLowerCase()));
    const singleWord = new Set([
      "id",
      "name",
      "type",
      "status",
      "attempt",
      "error",
      "result",
      "message",
      "truncated",
      "region",
      "input",
      "output",
      "operations",
      "year",
      "month",
      "day",
    ]);
    const unmapped = [...columns].filter(
      (c) => !mapped.has(c) && !singleWord.has(c),
    );
    expect(unmapped).toEqual([]);
  });
});

describe("RECORD_CAMEL_CASE_KEYS: the CDK stack carries the same list", () => {
  // The exporter's CDK stack defines the same Glue table but does not depend on
  // this package, so it repeats the list. A key added to one copy only would
  // load as NULL in the other table. So this reads the stack source and
  // compares the two lists.
  it("matches cdk/stack.ts", () => {
    const stack = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "aws-durable-execution-sdk-js-telemetry-exporter",
        "cdk",
        "stack.ts",
      ),
      "utf8",
    );
    const start = stack.indexOf("const RECORD_CAMEL_CASE_KEYS = [");
    expect(start).toBeGreaterThan(-1);
    const body = stack.slice(start, stack.indexOf("];", start));
    const stackKeys = [...body.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(stackKeys).toEqual([...RECORD_CAMEL_CASE_KEYS]);
  });
});
