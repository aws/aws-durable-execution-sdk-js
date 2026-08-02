import { emitRetryStrategy, normalizeStrategy } from "./strategy";
import type { RetryStrategySpec } from "./strategy";
import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

const EXP: RetryStrategySpec = {
  kind: "exponential",
  maxAttempts: 4,
  initialDelaySeconds: 2,
  maxDelaySeconds: 120,
  backoffRate: 3,
  incrementSeconds: 1,
  jitter: "HALF",
};

describe("emitRetryStrategy", () => {
  it("emits createRetryStrategy for exponential and records imports", () => {
    const imports = new Set<string>();
    const expr = emitRetryStrategy(EXP, imports);
    expect(expr).toBe(
      "createRetryStrategy({ maxAttempts: 4, initialDelay: { seconds: 2 }, " +
        "maxDelay: { seconds: 120 }, backoffRate: 3, jitter: JitterStrategy.HALF })",
    );
    expect([...imports].sort()).toEqual([
      "JitterStrategy",
      "createRetryStrategy",
    ]);
  });

  it("emits createLinearRetryStrategy for linear", () => {
    const imports = new Set<string>();
    const expr = emitRetryStrategy(
      { ...EXP, kind: "linear", incrementSeconds: 5, jitter: "NONE" },
      imports,
    );
    expect(expr).toBe(
      "createLinearRetryStrategy({ maxAttempts: 4, initialDelay: { seconds: 2 }, " +
        "increment: { seconds: 5 }, maxDelay: { seconds: 120 }, jitter: JitterStrategy.NONE })",
    );
    expect([...imports].sort()).toEqual([
      "JitterStrategy",
      "createLinearRetryStrategy",
    ]);
  });

  it("emits a single-attempt strategy for none (no jitter import)", () => {
    const imports = new Set<string>();
    const expr = emitRetryStrategy({ ...EXP, kind: "none" }, imports);
    expect(expr).toBe("createRetryStrategy({ maxAttempts: 1 })");
    expect([...imports]).toEqual(["createRetryStrategy"]);
  });
});

describe("normalizeStrategy", () => {
  it("fills missing fields from the fallback", () => {
    const out = normalizeStrategy({ maxAttempts: 9 }, EXP);
    expect(out.maxAttempts).toBe(9);
    expect(out.initialDelaySeconds).toBe(EXP.initialDelaySeconds);
    expect(out.kind).toBe("exponential");
  });
});

describe("generateHandler retry wiring", () => {
  function stepWithRetry(retry: unknown): DarWorkflow {
    return {
      darVersion: "1.0",
      name: "retry",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "StepA", code: "return 1;", retry },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
  }

  it("passes a retryStrategy config to the step and imports the builder", () => {
    const code = generateHandler(stepWithRetry(EXP));
    expect(code).toContain(
      "}, { retryStrategy: createRetryStrategy({ maxAttempts: 4,",
    );
    expect(code).toContain("  createRetryStrategy,");
    expect(code).toContain("  JitterStrategy,");
  });

  it("defaults to the exponential preset when a step has no retry spec", () => {
    const code = generateHandler(stepWithRetry(undefined));
    expect(code).toContain(
      "}, { retryStrategy: createRetryStrategy({ maxAttempts: 3,",
    );
  });
});
