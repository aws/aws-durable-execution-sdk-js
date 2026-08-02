import { App, Stack } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import { parseWorkflow } from "./darModel";
import { DurableWorkflowFunction } from "./DurableWorkflowFunction";

/**
 * `parseWorkflow` rebuilt the workflow from a fixed allowlist, so any top-level field it
 * did not know about was dropped. The construct then re-serializes that reduced object
 * into the deployment package, so reopening a construct-deployed workflow lost canvas
 * layout and anything a newer Studio had added — the same forward-compatibility loss the
 * Studio's own serializer was rewritten to avoid.
 */
describe("parseWorkflow preserves unknown top-level fields", () => {
  const parsed = parseWorkflow({
    darVersion: "1.0",
    name: "w",
    dependencyMode: "linear",
    layoutDirection: "LR",
    comment: "keep me",
    futureField: { a: 1 },
    nodes: [],
    edges: [],
  }) as unknown as Record<string, unknown>;

  it.each([
    ["layoutDirection", "LR"],
    ["comment", "keep me"],
  ])("keeps %s", (key, value) => {
    expect(parsed[key]).toBe(value);
  });

  it("keeps a field this version has never heard of", () => {
    expect(parsed.futureField).toEqual({ a: 1 });
  });

  it("still normalizes the validated fields", () => {
    // The spread must not let an invalid value through.
    const odd = parseWorkflow({ dependencyMode: "nonsense", nodes: [] });
    expect(odd.dependencyMode).toBe("linear");
    expect(odd.name).toBe("workflow");
  });
});

/**
 * `bundling.target` was hardcoded "node22" while `runtime` is overridable (functionProps
 * spreads after the default). A consumer downgrading the runtime — a common compatibility
 * move — kept getting a bundle transpiled for node22, which fails at cold start with a
 * SyntaxError rather than at synth, and only if they separately remembered to set
 * bundling.target themselves.
 */
describe("the esbuild target follows the effective runtime", () => {
  const synth = (runtime?: Runtime) => {
    const stack = new Stack(new App(), "S");
    new DurableWorkflowFunction(stack, "Wf", {
      ...(runtime ? { functionProps: { runtime } } : {}),
      workflow: {
        darVersion: "1.0",
        name: "w",
        dependencyMode: "linear",
        nodes: [
          {
            id: "a",
            kind: "step",
            name: "A",
            code: "return 1;",
            terminal: true,
          },
        ],
        edges: [],
      } as never,
    });
    return Template.fromStack(stack);
  };

  it("uses the overridden runtime", () => {
    synth(Runtime.NODEJS_20_X).hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
    });
  }, 180000);

  it("defaults to node22 when nothing is overridden", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
    });
  }, 180000);
});
