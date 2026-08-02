import * as ts from "typescript";
import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * Two validators accepted text the emitters could not hold, so a value that passed
 * validation produced generated code that was a SYNTAX ERROR — surfaced to the user
 * as an opaque esbuild failure instead of a clear synth-time message.
 *
 *  - `requireExpression` probed with the closing delimiter on its own line, so a
 *    trailing `//` survived the probe and then commented out the emitter's own `)`
 *    or `,`, which sit on the value's line.
 *  - `isExpressionText` re-implemented the same probe more weakly (only
 *    `parseDiagnostics.length === 0`, not "one statement of the expected kind") while
 *    gating RAW INLINING of a wait's `durationCode`.
 *
 * Neither was injection: the emission site nests deeper than the probe, so a balanced
 * escape fails. They were correctness bugs with a bad error surface.
 *
 * These tests assert on the PARSEABILITY of the generated output, not on substrings —
 * the whole class was invisible because nothing did that.
 */
function syntaxErrorCount(code: string): number {
  const sf = ts.createSourceFile("g.ts", code, ts.ScriptTarget.Latest, true);
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics
    .length;
}

const single = (node: Record<string, unknown>): DarWorkflow =>
  ({
    darVersion: "1.0",
    name: "w",
    dependencyMode: "linear",
    nodes: [node],
    edges: [],
  }) as unknown as DarWorkflow;

/** Either a clear rejection, or output that actually parses. Never anything else. */
function outcome(wf: DarWorkflow): "rejected" | number {
  try {
    return syntaxErrorCount(generateHandler(wf));
  } catch {
    return "rejected";
  }
}

describe("values that would break emission are rejected", () => {
  it("rejects a payload whose trailing comment would eat the delimiter", () => {
    expect(
      outcome(
        single({
          id: "a",
          kind: "chainInvoke",
          name: "C",
          functionArn: "arn:aws:lambda:us-east-1:1:function:f",
          payload: "{a:1} //",
          terminal: true,
        }),
      ),
    ).toBe("rejected");
  });

  /**
   * The invariant that matters is NEVER "always rejected" — it is that codegen either
   * refuses with a clear message or emits a handler that parses. It must not emit
   * broken code.
   *
   * `12 //` illustrates the difference: it is not a valid expression, so it takes the
   * BLOCK path, where the emitter's delimiters are on their own lines and a trailing
   * comment is harmless. Rejecting it would be wrong; emitting `{ seconds: (12 //) }`
   * was the bug.
   */
  it.each([
    ["closes and reopens parens", "1); (2"],
    ["trailing line comment", "12 //"],
    ["unbalanced brace", "return (5"],
    ["a bare keyword", "return"],
  ])(
    "never emits broken code for a durationCode that %s",
    (_label, durationCode) => {
      const r = outcome(
        single({
          id: "w",
          kind: "wait",
          name: "W",
          durationCode,
          terminal: true,
        }),
      );
      expect(r === "rejected" || r === 0).toBe(true);
    },
  );

  it("refuses a duration block that cannot parse, naming the node", () => {
    let message = "";
    try {
      generateHandler(
        single({
          id: "w",
          kind: "wait",
          name: "MyWait",
          durationCode: "1); (2",
          terminal: true,
        }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("MyWait");
    expect(message).toMatch(/would not parse|single expression/);
  });

  it.each([
    ["a return block", "return 5;"],
    ["a bare expression", "5"],
    ["a computed expression", "5 * 2"],
  ])("still accepts %s as a durationCode", (_label, durationCode) => {
    expect(
      outcome(
        single({
          id: "w",
          kind: "wait",
          name: "W",
          durationCode,
          terminal: true,
        }),
      ),
    ).toBe(0);
  });

  it("still accepts a real payload expression", () => {
    expect(
      outcome(
        single({
          id: "a",
          kind: "chainInvoke",
          name: "C",
          functionArn: "arn:aws:lambda:us-east-1:1:function:f",
          payload: "{ id: input.id }",
          terminal: true,
        }),
      ),
    ).toBe(0);
  });
});

/**
 * `durationCode` returns the wait in SECONDS (dar-specification.md), and the emitter
 * wraps it as `{ seconds: <code> }`. Returning a duration OBJECT is the natural
 * mistake — the SDK's own `wait()` takes `{ seconds: 30 }` — and it silently emitted
 * `{ seconds: { seconds: 30 } }`. esbuild does not typecheck, so that shipped and the
 * wait misbehaved at runtime with nothing to point at.
 *
 * Found by the handler-execution suite, not by reading: the emitted string looked
 * plausible.
 */
describe("durationCode must return seconds, not a duration object", () => {
  const durationWf = (durationCode: string) =>
    single({
      id: "w",
      kind: "wait",
      name: "Pause",
      durationCode,
      terminal: true,
    });

  it.each([
    "return { seconds: 30 };",
    "return { minutes: 5 };",
    "return { hours: 1 };",
  ])("rejects %s", (code) => {
    expect(() => generateHandler(durationWf(code))).toThrow(/in SECONDS/);
  });

  it("names the node so the error is actionable", () => {
    expect(() => generateHandler(durationWf("return { days: 2 };"))).toThrow(
      /Pause/,
    );
  });

  it.each(["return 30;", "30", "input.delay * 60"])("accepts %s", (code) => {
    expect(() => generateHandler(durationWf(code))).not.toThrow();
  });
});
