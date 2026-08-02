import { resolveWaitForCallbackDar } from "./assets/waitForCallback.dar.template";
import { validateDarJson } from "../agent";

describe("WaitForCallback .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveWaitForCallbackDar({
      region: "us-east-1",
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/Queue",
      snsTopicArn: "arn:aws:sns:us-east-1:123456789012:CallbackTopic",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
