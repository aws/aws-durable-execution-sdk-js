const mockSend = jest.fn();

jest.mock("@aws-sdk/client-rds-data", () => ({
  RDSDataClient: jest.fn(() => ({ send: mockSend })),
  ExecuteStatementCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { AuroraExporter } from "./aurora-exporter";
import { makeRecord } from "../test-utils/make-record";

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("AuroraExporter", () => {
  it("upserts via the postgres dialect with typed casts and bound parameters", async () => {
    const exporter = new AuroraExporter({
      resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:c1",
      secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:s1",
      database: "insight",
      engine: "postgresql",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.database).toBe("insight");
    expect(input.sql).toContain("INSERT INTO workflow_insight");
    expect(input.sql).toContain("ON CONFLICT (execution_arn) DO UPDATE");
    expect(input.sql).toContain("::timestamptz");
    expect(input.sql).toContain("::jsonb");

    const params = Object.fromEntries(
      input.parameters.map((p: { name: string; value: unknown }) => [
        p.name,
        p.value,
      ]),
    );
    expect(params.execution_arn).toEqual({
      stringValue: "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    });
    expect(params.record_json.stringValue).toContain('"recordType"');
  });

  it("uses the mysql dialect (ON DUPLICATE KEY, no casts) for engine mysql", async () => {
    const exporter = new AuroraExporter({
      resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:c1",
      secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:s1",
      database: "insight",
      engine: "mysql",
      table: "custom_table",
    });

    await exporter.export(makeRecord());

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.sql).toContain("INSERT INTO custom_table");
    expect(input.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(input.sql).not.toContain("::timestamptz");
    expect(input.sql).not.toContain("ON CONFLICT");
  });

  it("emits isNull for absent nullable fields", async () => {
    const exporter = new AuroraExporter({
      resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:c1",
      secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:s1",
      database: "insight",
      engine: "postgresql",
    });

    await exporter.export(
      makeRecord({
        executionName: undefined,
        endTime: undefined,
        durationMs: undefined,
      }),
    );

    const input = mockSend.mock.calls[0][0].__input;
    const params = Object.fromEntries(
      input.parameters.map((p: { name: string; value: unknown }) => [
        p.name,
        p.value,
      ]),
    );
    expect(params.execution_name).toEqual({ isNull: true });
    expect(params.end_time).toEqual({ isNull: true });
    expect(params.duration_ms).toEqual({ isNull: true });
  });
});
