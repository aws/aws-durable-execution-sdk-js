import { resolveTaskTimerDar } from "./assets/taskTimer.dar.template";
import { validateDarJson } from "../agent";

describe("TaskTimer .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveTaskTimerDar({
      region: "us-east-1",
      snsTopicArn: "arn:aws:sns:us-east-1:123456789012:TaskTimerTopic",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
