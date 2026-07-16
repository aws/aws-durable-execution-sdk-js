const mockSend = jest.fn();

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn(() => ({ send: mockSend })),
  SendMessageCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { SQSExporter } from "./sqs-exporter";
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

describe("SQSExporter", () => {
  it("sends a standard-queue message with attributes and no FIFO fields", async () => {
    const exporter = new SQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/insight",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.QueueUrl).toBe(
      "https://sqs.us-east-1.amazonaws.com/123456789012/insight",
    );
    expect(input.MessageGroupId).toBeUndefined();
    expect(input.MessageDeduplicationId).toBeUndefined();
    expect(input.MessageAttributes.status.StringValue).toBe("SUCCEEDED");
    expect(input.MessageAttributes.functionName.StringValue).toBe("fn");
    const body = JSON.parse(input.MessageBody);
    expect(body.executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
  });

  it("sets FIFO group and dedup ids for a .fifo queue", async () => {
    const exporter = new SQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/insight.fifo",
    });

    await exporter.export(makeRecord());

    const input = mockSend.mock.calls[0][0].__input;
    // Defaults the group id to the executionArn.
    expect(input.MessageGroupId).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(input.MessageDeduplicationId).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST:2026-07-15T12:00:00.000Z",
    );
  });

  it("honors an explicit messageGroupId on a FIFO queue", async () => {
    const exporter = new SQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/insight.fifo",
      messageGroupId: "custom-group",
    });

    await exporter.export(makeRecord());

    expect(mockSend.mock.calls[0][0].__input.MessageGroupId).toBe(
      "custom-group",
    );
  });
});
