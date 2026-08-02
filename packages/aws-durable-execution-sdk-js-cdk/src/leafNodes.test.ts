import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/** start → single leaf node. */
function oneNode(node: Record<string, unknown>): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "leaf",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "n", name: "op", ...node } as never,
    ],
    edges: [{ id: "e1", source: "s", target: "n" }],
  };
}

describe("leaf-kind codegen", () => {
  it("emits context.wait with the duration unit (no const binding)", () => {
    const code = generateHandler(
      oneNode({ kind: "wait", durationValue: 90, durationUnit: "seconds" }),
    );
    expect(code).toContain('await context.wait("op", { seconds: 90 });');
    expect(code).not.toContain("const op =");
    // A trailing wait returns undefined (nothing to bind).
    expect(code).toContain("return undefined;");
  });

  it("emits waitForCallback with the submitter body and timeout", () => {
    const code = generateHandler(
      oneNode({
        kind: "callback",
        timeoutValue: 2,
        timeoutUnit: "hours",
        submitterCode: "await notify(callbackId);",
      }),
    );
    expect(code).toContain(
      'const op = await context.waitForCallback("op", async (callbackId, ctx) => {',
    );
    expect(code).toContain("await notify(callbackId);");
    expect(code).toContain("}, { timeout: { hours: 2 } });");
  });

  it("emits context.invoke with the ARN and parsed payload", () => {
    const code = generateHandler(
      oneNode({
        kind: "chainInvoke",
        functionArn: "arn:aws:lambda:us-east-1:1:function:t:$LATEST",
        payload: '{ "a": 1 }',
      }),
    );
    expect(code).toContain(
      'const op = await context.invoke("op", "arn:aws:lambda:us-east-1:1:function:t:$LATEST", {"a":1});',
    );
  });

  it("emits waitForCondition with initialState and a wait strategy", () => {
    const code = generateHandler(
      oneNode({
        kind: "waitForCondition",
        code: "return { ...state, done: true };",
        initialState: '{ "n": 0 }',
        wait: { kind: "exponential", maxAttempts: 10 },
      }),
    );
    expect(code).toContain(
      'const op = await context.waitForCondition("op", async (state, ctx) => {',
    );
    expect(code).toContain('initialState: {"n":0}');
    expect(code).toContain("waitStrategy: createWaitStrategy({");
    expect(code).toContain("shouldContinuePolling:");
    expect(code).toContain("  createWaitStrategy,");
  });

  it("emits a first-class stop predicate from stopCondition", () => {
    const code = generateHandler(
      oneNode({
        kind: "waitForCondition",
        code: "return { ...state, count: state.count + 1 };",
        initialState: '{ "count": 0 }',
        stopCondition: "state.count >= 5",
        wait: { kind: "exponential", maxAttempts: 10 },
      }),
    );
    expect(code).toContain(
      "shouldContinuePolling: (state: any) => !(state.count >= 5)",
    );
    // The `{ done: true }` convention is not injected when a predicate is given.
    expect(code).not.toContain("(state as { done?: boolean }).done");
  });
});
