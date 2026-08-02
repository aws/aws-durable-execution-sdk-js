import { resolveDynamicParallelProcessingDar } from "./assets/dynamicParallelProcessing.dar.template";
import { validateDarJson } from "../agent";

// This pack's workflow uses dag dependency mode, which is gated because the
// generated code calls a runtime the SDK does not implement yet. Opting in here
// keeps the template's resolution + validation covered while the gate protects
// real deploys.
process.env.DAR_ALLOW_DAG_MODE = "1";

describe("DynamicParallelProcessing .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveDynamicParallelProcessingDar({
      region: "us-east-1",
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/Queue",
      ddbTableName: "DDBTable",
      snsTopicArn: "arn:aws:sns:us-east-1:123456789012:SNSTopic",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
