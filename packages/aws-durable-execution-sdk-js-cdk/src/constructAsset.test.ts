import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DurableWorkflowFunction } from "./DurableWorkflowFunction";
import { WORKFLOW_DAR_FILENAME, WORKFLOW_DAR_TAG_KEY } from "./darArtifact";

const wf = (nodes: unknown[], edges: unknown[] = []) =>
  ({
    darVersion: "1.0",
    name: "w",
    dependencyMode: "linear",
    nodes,
    edges,
  }) as never;

/**
 * The `.dar` embed had no synth assertion at all, so the copy could fail (or copy
 * nothing) and the suite stayed green. That is what let an absolute host source path
 * survive: it works under local bundling, which is all the tests exercised.
 */
describe("embedded .dar reaches the asset", () => {
  it("writes the workflow into the bundled asset", () => {
    const app = new App();
    const stack = new Stack(app, "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: wf([
        { id: "a", kind: "step", name: "A", code: "return 1;", terminal: true },
      ]),
    });
    const asm = app.synth();
    const assets = readdirSync(asm.directory).filter((d) =>
      d.startsWith("asset."),
    );
    const withDar = assets.filter((a) =>
      existsSync(join(asm.directory, a, WORKFLOW_DAR_FILENAME)),
    );
    expect(withDar.length).toBeGreaterThan(0);
  }, 180000);

  it("tags the function so a reader knows the .dar is there", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: wf([
        { id: "a", kind: "step", name: "A", code: "return 1;", terminal: true },
      ]),
    });
    // The tag is what tells a reader it is worth downloading the code package, so an
    // embed without the tag is invisible.
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Tags: [{ Key: WORKFLOW_DAR_TAG_KEY, Value: "1" }],
    });
  }, 180000);
});

/**
 * `isWildcard` matched only a resource that was exactly `"*"`. A chainInvoke's
 * `functionArn` flows into `resources` unvalidated, so `arn:aws:lambda:*:*:function:*`
 * classified as SCOPED and was auto-granted — defeating the control that
 * grantWildcardPermissions exists to provide.
 */
describe("wildcards inside an ARN are still wildcards", () => {
  const chain = (functionArn: string) =>
    wf(
      [
        { id: "s", kind: "start", name: "start" },
        {
          id: "c",
          kind: "chainInvoke",
          name: "C",
          functionArn,
          terminal: true,
        },
      ],
      [{ id: "e", source: "s", target: "c" }],
    );
  const policyText = (stack: Stack) =>
    JSON.stringify(Template.fromStack(stack).findResources("AWS::IAM::Policy"));

  it("withholds a grant for a wildcard ARN by default", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: chain("arn:aws:lambda:*:*:function:*"),
    });
    expect(policyText(stack)).not.toContain("lambda:InvokeFunction");
  }, 180000);

  it("grants a concrete ARN, which is the point of the distinction", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: chain("arn:aws:lambda:us-east-1:123456789012:function:target"),
    });
    expect(policyText(stack)).toContain("lambda:InvokeFunction");
  }, 180000);

  it("grants a wildcard ARN when explicitly opted in", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      grantWildcardPermissions: true,
      workflow: chain("arn:aws:lambda:*:*:function:*"),
    });
    expect(policyText(stack)).toContain("lambda:InvokeFunction");
  }, 180000);
});
