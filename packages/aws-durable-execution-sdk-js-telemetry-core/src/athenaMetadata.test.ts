/**
 * getTableLocation and getWorkGroupOutput, the two metadata reads the write
 * check depends on. Kept apart from athena.test.ts, whose Glue mock is inert.
 */
const glueSend = jest.fn();
jest.mock("@aws-sdk/client-glue", () => ({
  GlueClient: jest.fn(() => ({ send: glueSend })),
  GetTableCommand: jest.fn((input) => ({ input })),
}));
const athenaSend = jest.fn();
jest.mock("@aws-sdk/client-athena", () => ({
  AthenaClient: jest.fn(() => ({ send: athenaSend })),
  GetWorkGroupCommand: jest.fn((input) => ({ input })),
  StartQueryExecutionCommand: jest.fn(),
  GetQueryExecutionCommand: jest.fn(),
  GetQueryResultsCommand: jest.fn(),
}));

import { getTableLocation, getWorkGroupOutput } from "./athena";

const base = { region: "us-east-1", credentials: async () => ({}) as never };

beforeEach(() => {
  glueSend.mockReset();
  athenaSend.mockReset();
});

describe("getTableLocation", () => {
  const table = { ...base, database: "db", table: "t" };

  it("returns the table's storage location", async () => {
    glueSend.mockResolvedValue({
      Table: { StorageDescriptor: { Location: "s3://bucket/telemetry/" } },
    });
    expect(await getTableLocation(table)).toBe("s3://bucket/telemetry/");
    expect(glueSend).toHaveBeenCalledWith({
      input: { DatabaseName: "db", Name: "t" },
    });
  });

  it("returns undefined when the table does not exist", async () => {
    const err = Object.assign(new Error("not found"), {
      name: "EntityNotFoundException",
    });
    glueSend.mockRejectedValue(err);
    expect(await getTableLocation(table)).toBeUndefined();
  });

  it("returns undefined when the table has no location", async () => {
    glueSend.mockResolvedValue({ Table: { StorageDescriptor: {} } });
    expect(await getTableLocation(table)).toBeUndefined();
  });

  it("rethrows any other Glue error, so the write check reports unknown", async () => {
    const err = Object.assign(new Error("denied"), {
      name: "AccessDeniedException",
    });
    glueSend.mockRejectedValue(err);
    await expect(getTableLocation(table)).rejects.toThrow("denied");
  });
});

describe("getWorkGroupOutput", () => {
  it("reports an enforced workgroup and its location", async () => {
    athenaSend.mockResolvedValue({
      WorkGroup: {
        Configuration: {
          EnforceWorkGroupConfiguration: true,
          ResultConfiguration: { OutputLocation: "s3://results/" },
        },
      },
    });
    expect(await getWorkGroupOutput({ ...base, workgroup: "team" })).toEqual({
      enforced: true,
      outputLocation: "s3://results/",
    });
    expect(athenaSend).toHaveBeenCalledWith({ input: { WorkGroup: "team" } });
  });

  it("reports a workgroup that does not enforce and sets no location", async () => {
    athenaSend.mockResolvedValue({ WorkGroup: { Configuration: {} } });
    expect(await getWorkGroupOutput({ ...base, workgroup: "primary" })).toEqual(
      { enforced: false, outputLocation: undefined },
    );
  });
});
