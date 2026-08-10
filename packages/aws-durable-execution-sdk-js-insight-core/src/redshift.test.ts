// Mock the Redshift Data API client so we can drive the async
// execute→poll→getResult flow deterministically.
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-redshift-data", () => ({
  RedshiftDataClient: jest.fn(() => ({ send: mockSend })),
  ExecuteStatementCommand: jest.fn((i) => ({ __type: "exec", i })),
  DescribeStatementCommand: jest.fn((i) => ({ __type: "describe", i })),
  GetStatementResultCommand: jest.fn((i) => ({ __type: "getResult", i })),
}));

import { runRedshiftQuery, fetchRedshiftRecord } from "./redshift";

const conn = {
  region: "us-east-1",
  credentials: {} as never,
  database: "dev",
  workgroupName: "wg",
};

beforeEach(() => jest.clearAllMocks());

describe("runRedshiftQuery", () => {
  it("executes, polls to FINISHED, and normalizes rows + numeric flags", async () => {
    mockSend.mockImplementation((cmd: { __type: string; i: unknown }) => {
      switch (cmd.__type) {
        case "exec":
          return Promise.resolve({ Id: "s1" });
        case "describe":
          return Promise.resolve({ Status: "FINISHED" });
        case "getResult":
          return Promise.resolve({
            ColumnMetadata: [
              { name: "status", typeName: "varchar" },
              { name: "ct", typeName: "int8" },
            ],
            Records: [
              [{ stringValue: "SUCCEEDED" }, { longValue: 5 }],
              [{ stringValue: "FAILED" }, { longValue: 2 }],
            ],
          });
        default:
          throw new Error(`unexpected command ${cmd.__type}`);
      }
    });

    const res = await runRedshiftQuery({ ...conn, sql: "SELECT status, ct" });
    expect(res.columns).toEqual(["status", "ct"]);
    expect(res.rows).toEqual([
      ["SUCCEEDED", "5"],
      ["FAILED", "2"],
    ]);
    expect(res.count).toBe(2);
    // varchar → not numeric, int8 → numeric
    expect(res.numericColumns).toEqual([false, true]);
  });

  it("throws when the statement reports FAILED", async () => {
    mockSend.mockImplementation((cmd: { __type: string }) => {
      if (cmd.__type === "exec") return Promise.resolve({ Id: "s1" });
      if (cmd.__type === "describe")
        return Promise.resolve({ Status: "FAILED", Error: "boom" });
      throw new Error("getResult should not be called");
    });
    await expect(
      runRedshiftQuery({ ...conn, sql: "SELECT 1" }),
    ).rejects.toThrow(/failed: boom/i);
  });

  it("follows NextToken pagination and keeps first-page column metadata", async () => {
    let getResultCalls = 0;
    mockSend.mockImplementation((cmd: { __type: string }) => {
      if (cmd.__type === "exec") return Promise.resolve({ Id: "s1" });
      if (cmd.__type === "describe")
        return Promise.resolve({ Status: "FINISHED" });
      // getResult
      getResultCalls += 1;
      if (getResultCalls === 1) {
        return Promise.resolve({
          ColumnMetadata: [{ name: "arn", typeName: "varchar" }],
          Records: [[{ stringValue: "a" }]],
          NextToken: "n1",
        });
      }
      return Promise.resolve({ Records: [[{ stringValue: "b" }]] });
    });

    const res = await runRedshiftQuery({ ...conn, sql: "SELECT arn" });
    expect(getResultCalls).toBe(2);
    expect(res.columns).toEqual(["arn"]);
    expect(res.rows).toEqual([["a"], ["b"]]);
  });
});

describe("fetchRedshiftRecord", () => {
  it("parses the record_json SUPER blob into flat top-level fields", async () => {
    const record = {
      executionArn: "arn:1",
      status: "SUCCEEDED",
      input: { a: 1 },
      operations: [{ name: "step1" }],
    };
    mockSend.mockImplementation((cmd: { __type: string }) => {
      if (cmd.__type === "exec") return Promise.resolve({ Id: "s1" });
      if (cmd.__type === "describe")
        return Promise.resolve({ Status: "FINISHED" });
      return Promise.resolve({
        Records: [[{ stringValue: JSON.stringify(record) }]],
      });
    });

    const out = await fetchRedshiftRecord({
      ...conn,
      table: "public.workflow_insight",
      executionArn: "arn:1",
    });
    expect(out).toBeDefined();
    expect(out!.executionArn).toBe("arn:1");
    expect(out!.status).toBe("SUCCEEDED");
    // objects are JSON-stringified
    expect(out!.input).toBe(JSON.stringify({ a: 1 }));
    expect(out!.operations).toBe(JSON.stringify([{ name: "step1" }]));
  });

  it("returns undefined when there is no matching row", async () => {
    mockSend.mockImplementation((cmd: { __type: string }) => {
      if (cmd.__type === "exec") return Promise.resolve({ Id: "s1" });
      if (cmd.__type === "describe")
        return Promise.resolve({ Status: "FINISHED" });
      return Promise.resolve({ Records: [] });
    });
    const out = await fetchRedshiftRecord({
      ...conn,
      table: "public.workflow_insight",
      executionArn: "missing",
    });
    expect(out).toBeUndefined();
  });
});
