const mockSend = jest.fn();

jest.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { EventBridgeExporter } from "./eventbridge-exporter";
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
  mockSend.mockResolvedValue({ FailedEntryCount: 0 });
});

describe("EventBridgeExporter", () => {
  it("publishes a single event with status DetailType and the record as Detail", async () => {
    const exporter = new EventBridgeExporter({ region: "us-east-1" });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const entry = mockSend.mock.calls[0][0].__input.Entries[0];
    expect(entry.EventBusName).toBe("default");
    expect(entry.Source).toBe("aws.durable-execution.insight");
    expect(entry.DetailType).toBe("SUCCEEDED");
    const detail = JSON.parse(entry.Detail);
    expect(detail.executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    // Default operationsFormat is "array".
    expect(Array.isArray(detail.operations)).toBe(true);
  });

  it("renders operationsByName when operationsFormat is by-name and uses a custom bus/source", async () => {
    const exporter = new EventBridgeExporter({
      eventBusName: "insight-bus",
      source: "my.source",
      operationsFormat: "by-name",
    });

    await exporter.export(makeRecord());

    const entry = mockSend.mock.calls[0][0].__input.Entries[0];
    expect(entry.EventBusName).toBe("insight-bus");
    expect(entry.Source).toBe("my.source");
    const detail = JSON.parse(entry.Detail);
    expect(detail.operations).toBeUndefined();
    expect(detail.operationsByName["fetch-user"].count).toBe(1);
  });

  it("throws when PutEvents reports a failed entry", async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [
        { ErrorCode: "ThrottlingException", ErrorMessage: "slow down" },
      ],
    });
    const exporter = new EventBridgeExporter();

    await expect(exporter.export(makeRecord())).rejects.toThrow(
      /ThrottlingException/,
    );
  });
});
