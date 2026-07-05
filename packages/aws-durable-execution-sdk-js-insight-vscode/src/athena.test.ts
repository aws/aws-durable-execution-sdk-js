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

import { runAthenaQuery } from "./athena";

/** Build a GetQueryResults page. The first page carries the header row. */
function page(dataRows: string[][], withHeader: boolean, nextToken?: string) {
  const rows = dataRows.map((r) => ({
    Data: r.map((v) => ({ VarCharValue: v })),
  }));
  return {
    ResultSet: {
      Rows: withHeader ? [{ Data: [{ VarCharValue: "col1" }] }, ...rows] : rows,
      ResultSetMetadata: { ColumnInfo: [{ Name: "col1" }] },
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
