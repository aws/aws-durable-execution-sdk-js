import { resolveHelloLambdaDar } from "./assets/helloLambda.dar.template";
import { validateDarJson } from "../agent";

describe("HelloLambda .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveHelloLambdaDar({
      region: "us-east-1",
      checkStockPriceLambdaArn:
        "arn:aws:lambda:us-east-1:123456789012:function:CheckStockPriceLambda:$LATEST",
      buyStockLambdaArn:
        "arn:aws:lambda:us-east-1:123456789012:function:BuyStockLambda:$LATEST",
      sellStockLambdaArn:
        "arn:aws:lambda:us-east-1:123456789012:function:SellStockLambda:$LATEST",
      requestHumanApprovalSqsUrl:
        "https://sqs.us-east-1.amazonaws.com/123456789012/RequestHumanApprovalSqs",
      reportResultSnsTopicArn:
        "arn:aws:sns:us-east-1:123456789012:ReportResultSnsTopic",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
