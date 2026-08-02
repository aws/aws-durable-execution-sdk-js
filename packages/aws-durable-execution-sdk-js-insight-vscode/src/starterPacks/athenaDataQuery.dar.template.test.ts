import { resolveAthenaDataQueryDar } from "./assets/athenaDataQuery.dar.template";
import { validateDarJson } from "../agent";

describe("AthenaDataQuery .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveAthenaDataQueryDar({
      region: "us-east-1",
      dataGenerationLambdaArn:
        "arn:aws:lambda:us-east-1:123456789012:function:LambdaForDataGeneration",
      crawlerName: "athena-sample-project-crawler-abc1234567",
      glueDatabase: "athena-sample-project-db-abc1234567",
      athenaWorkgroup:
        "stepfunctions-athena-sample-project-workgroup-abc1234567",
      snsTopicArn: "arn:aws:sns:us-east-1:123456789012:SNSTopic",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
