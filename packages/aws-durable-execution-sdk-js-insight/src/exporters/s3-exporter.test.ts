const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { S3Exporter } from "./s3-exporter";
import type { WorkflowInsightRecord } from "../types";

function makeRecord(
  overrides: Partial<WorkflowInsightRecord> = {},
): WorkflowInsightRecord {
  return {
    recordType: "WorkflowInsight",
    schemaVersion: "1.0",
    emittedAt: "2026-07-15T12:00:00.000Z",
    executionArn: "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    executionName: "my-exec",
    functionName: "fn",
    functionQualifier: "$LATEST",
    region: "us-east-1",
    accountId: "123456789012",
    status: "SUCCEEDED",
    startTime: "2026-06-16T11:59:00.000Z",
    endTime: "2026-06-16T12:00:00.000Z",
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

describe("S3Exporter", () => {
  it("writes a Hive-partitioned, execution-named JSON object by default (date partitioning)", async () => {
    const exporter = new S3Exporter({
      bucket: "insight-bucket",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.Bucket).toBe("insight-bucket");
    expect(input.ContentType).toBe("application/json");
    // startTime = 2026-06-16 → year=2026/month=06/day=16 partition.
    expect(input.Key).toBe(
      "workflow-insight/year=2026/month=06/day=16/my-exec.json",
    );
    expect(JSON.parse(input.Body).executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
  });

  it("partitions by function name when configured", async () => {
    const exporter = new S3Exporter({
      bucket: "insight-bucket",
      partitioning: "function-name",
      prefix: "wi/",
    });

    await exporter.export(makeRecord());

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.Key).toBe("wi/function=fn/my-exec.json");
  });

  it("writes flat under the prefix when partitioning is none", async () => {
    const exporter = new S3Exporter({
      bucket: "insight-bucket",
      partitioning: "none",
    });

    await exporter.export(makeRecord());

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.Key).toBe("workflow-insight/my-exec.json");
  });
});
