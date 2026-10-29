/**
 * The renderer repeats core's execution-ARN rules, because it cannot import
 * core (core pulls in the AWS SDK). This test checks the two agree, so the
 * renderer never offers an Open link the host then refuses.
 */
import { isDurableExecutionArn } from "@aws/durable-execution-sdk-js-telemetry-core";
import { looksLikeExecutionArn } from "../webview-ui/src/executionFormat";

const base =
  "arn:aws:lambda:us-east-1:123456789012:function:orders:$LATEST/durable-execution/run-1/abc";

const CASES = [
  base,
  base.replace(":$LATEST", ""),
  base.replace(":$LATEST", ":7"),
  base.replace("aws:", "aws-cn:").replace("us-east-1", "cn-north-1"),
  base.replace("aws:", "aws-us-gov:"),
  `${base})x`,
  `${base} `,
  `${base}/`,
  base.replace("/run-1/", "//"),
  base.replace("123456789012", "123"),
  base.replace("us-east-1", "<region>"),
  base.replace("us-east-1", "US-EAST-1"),
  base.replace("lambda", "s3"),
  base.replace("function:orders", "function:"),
  base.replace("/run-1/abc", "/a:b/i"),
  `${base.split("/durable-execution/")[0]}/durable-execution/`,
  `${base.split("/durable-execution/")[0]}/durable-execution//durable-execution/x`,
  `${base}${"x".repeat(2100)}`,
  "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
  "not-an-arn",
  "",
];

describe("ARN rules match core", () => {
  it.each(CASES.map((c) => [JSON.stringify(c.slice(0, 120)), c]))(
    "%s",
    (_label, value) => {
      expect(looksLikeExecutionArn(value)).toBe(isDurableExecutionArn(value));
    },
  );
  it("covers both outcomes", () => {
    expect(CASES.some((c) => isDurableExecutionArn(c))).toBe(true);
    expect(CASES.some((c) => !isDurableExecutionArn(c))).toBe(true);
  });
});
