/**
 * ⚠️ These tests synthesize a real `NodejsFunction`, so esbuild bundles the
 * generated handler for real — which means the core SDK's built output must
 * already exist on disk. Without it, esbuild fails with an opaque
 * `FailedToBundleAsset` that says nothing about the actual cause.
 *
 * CI satisfies this by downloading the `built-artifacts` bundle (whose glob
 * covers each package's dist directories) before running tests; locally
 * `npm run build` does the same. If that glob ever stops matching the SDK's
 * output, this suite is where it surfaces — and it will not look like a
 * build-order problem.
 */
import { App, Duration, Stack } from "aws-cdk-lib";
import { Template, Match, Annotations } from "aws-cdk-lib/assertions";
import { DurableWorkflowFunction } from "./DurableWorkflowFunction";
import type { DarWorkflow } from "./darModel";

/** start → step1 (terminal) → end. */
function simpleWorkflow(): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "greet",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "Greet", code: "return { hello: true };" },
    ],
    edges: [{ id: "e1", source: "s", target: "a" }],
  };
}

describe("DurableWorkflowFunction (wiring)", () => {
  it("generates the handler and infers the execution timeout", () => {
    const stack = new Stack(new App(), "S");
    const fn = new DurableWorkflowFunction(stack, "Wf", {
      workflow: simpleWorkflow(),
    });
    expect(fn.generatedCode).toContain(
      'const Greet = await context.step("Greet"',
    );
    // No waits ⇒ floored at the 60s minimum.
    expect(fn.executionTimeout.toSeconds()).toBe(60);
    expect(fn.alias).toBeDefined();
    expect(fn.version).toBeDefined();
  });

  it("honours an explicit executionTimeout override", () => {
    const stack = new Stack(new App(), "S");
    const fn = new DurableWorkflowFunction(stack, "Wf", {
      workflow: simpleWorkflow(),
      executionTimeout: Duration.minutes(30),
    });
    expect(fn.executionTimeout.toSeconds()).toBe(1800);
  });

  it("throws when neither workflow nor darPath is given", () => {
    const stack = new Stack(new App(), "S");
    expect(() => new DurableWorkflowFunction(stack, "Wf", {})).toThrow(
      /workflow.*darPath/,
    );
  });
});

/** A workflow whose only inferred permission has an unresolvable resource. */
const WILDCARD_WORKFLOW = {
  darVersion: "1.0",
  name: "store",
  dependencyMode: "linear",
  nodes: [
    { id: "s", kind: "start", name: "start" },
    {
      id: "a",
      kind: "step",
      name: "Put",
      code: 'const { PutObjectCommand } = require("@aws-sdk/client-s3"); new PutObjectCommand({}); return {};',
    },
  ],
  edges: [{ id: "e1", source: "s", target: "a" }],
} as never;

describe("DurableWorkflowFunction (synth)", () => {
  it("synthesizes a durable Lambda with a version and alias", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: simpleWorkflow(),
      retentionPeriod: Duration.days(7),
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      DurableConfig: {
        ExecutionTimeout: 60,
        RetentionPeriodInDays: 7,
      },
    });
    template.resourceCountIs("AWS::Lambda::Version", 1);
    template.resourceCountIs("AWS::Lambda::Alias", 1);
    template.hasResourceProperties("AWS::Lambda::Alias", { Name: "live" });
  }, 120000);

  it("withholds inferred permissions whose resources are wildcards", () => {
    // Actions are inferred by regex over step code, which cannot know WHICH
    // bucket a call targets, so the statement comes out as Resource: "*".
    // Attaching that automatically made the construct grant wildcard access off a
    // pattern match. It is now withheld and reported instead.
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: WILDCARD_WORKFLOW,
    });
    const template = Template.fromStack(stack);
    const policies = template.findResources("AWS::IAM::Policy");
    const granted = JSON.stringify(policies);
    expect(granted).not.toContain("s3:PutObject");
    expect(
      Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("s3:PutObject"),
      ).length,
    ).toBeGreaterThan(0);
  }, 120000);

  it("grants wildcard permissions when explicitly opted in", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      grantWildcardPermissions: true,
      workflow: WILDCARD_WORKFLOW,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "s3:PutObject", Effect: "Allow" }),
        ]),
      },
    });
  }, 120000);

  it("skips permission grants when grantInferredPermissions is false", () => {
    const stack = new Stack(new App(), "S");
    const fn = new DurableWorkflowFunction(stack, "Wf", {
      grantInferredPermissions: false,
      workflow: {
        darVersion: "1.0",
        name: "store",
        dependencyMode: "linear",
        nodes: [
          { id: "s", kind: "start", name: "start" },
          {
            id: "a",
            kind: "step",
            name: "Put",
            code: 'const { PutObjectCommand } = require("@aws-sdk/client-s3"); new PutObjectCommand({});',
          },
        ],
        edges: [{ id: "e1", source: "s", target: "a" }],
      },
    });
    const json = JSON.stringify(Template.fromStack(stack).toJSON());
    expect(fn).toBeDefined();
    expect(json).not.toContain("s3:PutObject");
  }, 120000);
});

describe("permission inference warnings reach synth", () => {
  it("surfaces under-grant signals instead of dropping them", () => {
    // These are the signals that a permission could NOT be attributed. Dropping
    // them meant deploy succeeded, the function hit AccessDenied at runtime, and
    // synth had said nothing.
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      workflow: {
        darVersion: "1.0",
        name: "unknownJob",
        dependencyMode: "linear",
        nodes: [
          { id: "s", kind: "start", name: "start" },
          {
            // A command with no `@aws-sdk/client-*` import to attribute it to, so
            // the analyzer cannot tell which service to grant.
            id: "j",
            kind: "step",
            name: "J",
            code: "await client.send(new PutObjectCommand({})); return 1;",
            terminal: true,
          },
        ],
        edges: [{ id: "e1", source: "s", target: "j" }],
      } as never,
    });
    expect(
      Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Permission inference"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("sets a real Lambda invocation timeout, not the 3s default", () => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", { workflow: WILDCARD_WORKFLOW });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 60,
    });
  });
});
