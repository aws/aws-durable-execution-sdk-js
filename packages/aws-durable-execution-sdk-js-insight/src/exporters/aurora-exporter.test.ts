const mockSend = jest.fn();

jest.mock("@aws-sdk/client-rds-data", () => ({
  RDSDataClient: jest.fn(() => ({ send: mockSend })),
  ExecuteStatementCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { AuroraExporter } from "./aurora-exporter";
import type { WorkflowInsightRecord } from "../types";

function makeRecord(
  overrides: Partial<WorkflowInsightRecord> = {},
): WorkflowInsightRecord {
  return {
    recordType: "WorkflowInsight",
    schemaVersion: "1.0",
    emittedAt: "2026-07-15T12:00:00.000Z",
    executionArn: "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    executionName: "exec-1",
    functionName: "fn",
    functionQualifier: "$LATEST",
    region: "us-east-1",
    accountId: "123456789012",
    status: "SUCCEEDED",
    startTime: "2026-07-15T11:59:00.000Z",
    endTime: "2026-07-15T12:00:00.000Z",
    durationMs: 60000,
    input: { orderId: "12345" },
    output: { ok: true },
    operations: [
      {
        id: "o1",
        name: "fetch-user",
        type: "STEP",
        status: "SUCCEEDED",
        durationMs: 5,
      },
    ],
    ...overrides,
  };
}

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
