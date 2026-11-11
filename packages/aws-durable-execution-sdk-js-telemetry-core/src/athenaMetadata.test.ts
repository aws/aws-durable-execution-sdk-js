/**
 * getTableLocation and getWorkGroupOutput, the two metadata reads the write
 * check depends on. Kept apart from athena.test.ts, whose Glue mock is inert.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
const glueSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-glue", () => ({
  GlueClient: vi.fn(() => ({ send: glueSend })),
  GetTableCommand: vi.fn((input) => ({ input })),
}));
const athenaSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-athena", () => ({
  AthenaClient: vi.fn(() => ({ send: athenaSend })),
  GetWorkGroupCommand: vi.fn((input) => ({ input })),
  StartQueryExecutionCommand: vi.fn(),
  GetQueryExecutionCommand: vi.fn(),
  GetQueryResultsCommand: vi.fn(),
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

  it("rethrows any other Glue error, so the location check reports undetermined", async () => {
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
