const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  PutItemCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

jest.mock("@aws-sdk/util-dynamodb", () => ({
  // Pass the item through untouched so tests can inspect the raw shape.
  marshall: jest.fn((item: unknown) => item),
}));

import { DynamoDBExporter } from "./dynamodb-exporter";
import { makeRecord } from "../test-utils/make-record";

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("DynamoDBExporter", () => {
  it("writes history items keyed by pk=executionArn and sk=emittedAt", async () => {
    const exporter = new DynamoDBExporter({
      tableName: "insight",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.TableName).toBe("insight");
    expect(input.Item.pk).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(input.Item.sk).toBe("2026-07-15T12:00:00.000Z");
    // render/withOperationsByName folds the operations array into a map.
    expect(input.Item.operationsByName["fetch-user"].count).toBe(1);
    expect(input.Item.operations).toBeUndefined();
  });

  it("upserts (no sort key) when sortKey is disabled and honors a custom partition key", async () => {
    const exporter = new DynamoDBExporter({
      tableName: "insight",
      partitionKey: "executionArnKey",
      sortKey: "",
    });

    await exporter.export(makeRecord());

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.Item.executionArnKey).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(input.Item.sk).toBeUndefined();
  });
});
