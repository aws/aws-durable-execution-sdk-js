const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { S3Exporter } from "./s3-exporter";
import { makeRecord } from "../test-utils/make-record";

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

    await exporter.export(
      makeRecord({
        executionName: "my-exec",
        startTime: "2026-06-16T11:59:00.000Z",
        endTime: "2026-06-16T12:00:00.000Z",
      }),
    );

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

    await exporter.export(
      makeRecord({
        executionName: "my-exec",
        startTime: "2026-06-16T11:59:00.000Z",
        endTime: "2026-06-16T12:00:00.000Z",
      }),
    );

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.Key).toBe("wi/function=fn/my-exec.json");
  });

  it("writes flat under the prefix when partitioning is none", async () => {
    const exporter = new S3Exporter({
      bucket: "insight-bucket",
      partitioning: "none",
    });

    await exporter.export(
      makeRecord({
        executionName: "my-exec",
        startTime: "2026-06-16T11:59:00.000Z",
        endTime: "2026-06-16T12:00:00.000Z",
      }),
    );

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.Key).toBe("workflow-insight/my-exec.json");
  });
});
