const mockSend = jest.fn();

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn(() => ({ send: mockSend })),
  SendMessageCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { SQSExporter, fifoId } from "./sqs-exporter";
import { makeRecord } from "../test-utils/make-record";

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("SQSExporter", () => {
  it("treats an empty messageGroupId as omitted on a standard queue: no group id is sent", async () => {
    const exporter = new SQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry",
      messageGroupId: "",
    });

    await exporter.export(makeRecord());

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.MessageGroupId).toBeUndefined();
    expect(input.MessageDeduplicationId).toBeUndefined();
  });

  it("treats an empty messageGroupId as omitted on a FIFO queue: groups by executionArn", async () => {
    const exporter = new SQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/t.fifo",
      messageGroupId: "",
    });
    const record = makeRecord();

    await exporter.export(record);

    expect(mockSend.mock.calls[0][0].__input.MessageGroupId).toBe(
      record.executionArn,
    );
  });

  it("sends a standard-queue message with attributes and no FIFO fields", async () => {
    const exporter = new SQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.QueueUrl).toBe(
      "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry",
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
      queueUrl:
        "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry.fifo",
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
      queueUrl:
        "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry.fifo",
      messageGroupId: "custom-group",
    });

    await exporter.export(makeRecord());

    expect(mockSend.mock.calls[0][0].__input.MessageGroupId).toBe(
      "custom-group",
    );
  });

  describe("FIFO ids over the SQS 128-character limit", () => {
    // A realistic 144-character durable execution ARN. The expected digests were
    // computed independently with Python's hashlib:
    //   hashlib.sha256(value.encode("utf-8")).hexdigest()
    // The Python and Java exporters apply the same rule to the same input
    // string. (Their dedup input embeds their own emittedAt format, so a real
    // record's dedup id can differ across SDKs.)
    const LONG_ARN =
      "arn:aws:lambda:us-east-1:123456789012:function:order-processor:$LATEST/durable-execution/order-bdd640fb0667/23b8c1e9-3924-46de-beb1-3b9046685257";
    const EMITTED_AT = "2026-01-01T00:00:10.000Z";
    const GROUP_DIGEST =
      "170a1c1ff1dda2b2794acd77c3ae7bb96d09b3a38a1b9b16908fcde381801e4d";
    const DEDUP_DIGEST =
      "f9c598b766c105226add0b8a43d72bb84a567ff7d3cf630f41ee53d326ecc1c6";

    it("replaces a long group id and dedup id with their SHA-256 hex digests", async () => {
      expect(LONG_ARN).toHaveLength(144);
      const exporter = new SQSExporter({
        queueUrl:
          "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry.fifo",
      });

      await exporter.export(
        makeRecord({ executionArn: LONG_ARN, emittedAt: EMITTED_AT }),
      );

      const input = mockSend.mock.calls[0][0].__input;
      // The dedup id hashes the same `executionArn:emittedAt` string the
      // exporter used before, not the bare ARN.
      expect(`${LONG_ARN}:${EMITTED_AT}`).toHaveLength(169);
      expect(input.MessageGroupId).toBe(GROUP_DIGEST);
      expect(input.MessageDeduplicationId).toBe(DEDUP_DIGEST);
      // The body still carries the full ARN.
      expect(JSON.parse(input.MessageBody).executionArn).toBe(LONG_ARN);
    });

    it("hashes a long explicit messageGroupId too", async () => {
      const exporter = new SQSExporter({
        queueUrl:
          "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry.fifo",
        messageGroupId: LONG_ARN,
      });

      await exporter.export(makeRecord());

      expect(mockSend.mock.calls[0][0].__input.MessageGroupId).toBe(
        GROUP_DIGEST,
      );
    });

    it("keeps ids of up to 128 characters unchanged", () => {
      const short = "arn:aws:lambda:us-east-1:123456789012:function:fn:1";
      expect(fifoId(short)).toBe(short);
      const atLimit = "a".repeat(128);
      expect(fifoId(atLimit)).toBe(atLimit);
      const overLimit = fifoId("a".repeat(129));
      expect(overLimit).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
