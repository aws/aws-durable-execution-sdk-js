const mockSend = jest.fn();

jest.mock("@aws-sdk/client-firehose", () => ({
  FirehoseClient: jest.fn(() => ({ send: mockSend })),
  PutRecordCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { FirehoseExporter } from "./firehose-exporter";
import { makeRecord } from "../test-utils/make-record";

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("FirehoseExporter", () => {
  it("puts a single NDJSON record with a trailing newline", async () => {
    const exporter = new FirehoseExporter({
      deliveryStreamName: "insight-stream",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.DeliveryStreamName).toBe("insight-stream");

    const text = decode(input.Record.Data);
    expect(text.endsWith("\n")).toBe(true);
    // Exactly one JSON object followed by the delimiter (NDJSON friendly).
    expect(text.trimEnd().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(text);
    expect(parsed.executionArn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(Array.isArray(parsed.operations)).toBe(true);
  });

  it("renders operationsByName when operationsFormat is by-name", async () => {
    const exporter = new FirehoseExporter({
      deliveryStreamName: "insight-stream",
      operationsFormat: "by-name",
    });

    await exporter.export(makeRecord());

    const parsed = JSON.parse(
      decode(mockSend.mock.calls[0][0].__input.Record.Data),
    );
    expect(parsed.operations).toBeUndefined();
    expect(parsed.operationsByName["fetch-user"].count).toBe(1);
  });
});
