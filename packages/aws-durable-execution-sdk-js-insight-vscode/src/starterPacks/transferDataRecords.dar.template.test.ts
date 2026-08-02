import { resolveTransferDataRecordsDar } from "./assets/transferDataRecords.dar.template";
import { validateDarJson } from "../agent";

describe("TransferDataRecords .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveTransferDataRecordsDar({
      region: "us-east-1",
      seedingFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:SeedingFunction",
      ddbTableName: "TransferDataRecords-DDBTable-ABC123",
      sqsQueueUrl:
        "https://sqs.us-east-1.amazonaws.com/123456789012/TransferDataRecords-SQSQueue-ABC123",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
