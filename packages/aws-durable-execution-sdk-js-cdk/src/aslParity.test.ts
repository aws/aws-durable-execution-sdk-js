import type { DarWorkflow } from "./darModel";
import { generateHandler } from "./generateHandler";

const wrap = (nodes: unknown[], edges: unknown[]): DarWorkflow =>
  ({
    darVersion: "1.0",
    name: "t",
    dependencyMode: "linear",
    nodes: [{ id: "s", kind: "start", name: "start" }, ...nodes],
    edges,
  }) as never;

describe("ASL-parity features", () => {
  it("matches any of a comma-separated errorType list (multi-error catch)", () => {
    const code = generateHandler(
      wrap(
        [
          { id: "a", kind: "step", name: "Call", code: "return api();" },
          { id: "h", kind: "step", name: "Recover", code: "return fix(err);" },
        ],
        [
          { id: "e1", source: "s", target: "a" },
          {
            id: "b1",
            source: "a",
            target: "h",
            kind: "error",
            errorType: "TimeoutError, ValidationError",
          },
        ],
      ),
    );
    expect(code).toContain(
      "if (err instanceof TimeoutError || err instanceof ValidationError) {",
    );
  });

  it("emits a dynamic wait duration from durationCode", () => {
    const code = generateHandler(
      wrap(
        [
          { id: "a", kind: "step", name: "Fetch", code: "return cfg();" },
          {
            id: "w",
            kind: "wait",
            name: "backoff",
            durationValue: 1,
            durationUnit: "seconds",
            durationCode: "return Fetch.delaySeconds;",
          },
        ],
        [
          { id: "e1", source: "s", target: "a" },
          { id: "e2", source: "a", target: "w" },
        ],
      ),
    );
    expect(code).toContain('await context.wait("backoff", { seconds: (() => {');
    expect(code).toContain("return Fetch.delaySeconds;");
  });

  it("keeps the static duration when durationCode is absent", () => {
    const code = generateHandler(
      wrap(
        [
          {
            id: "w",
            kind: "wait",
            name: "cooldown",
            durationValue: 30,
            durationUnit: "seconds",
          },
        ],
        [{ id: "e1", source: "s", target: "w" }],
      ),
    );
    expect(code).toContain('await context.wait("cooldown", { seconds: 30 })');
  });

  it("emits node comments above the operation", () => {
    const code = generateHandler(
      wrap(
        [
          {
            id: "a",
            kind: "step",
            name: "Charge",
            code: "return pay();",
            comment: "Charges the customer card.\nRetries are safe.",
          },
        ],
        [{ id: "e1", source: "s", target: "a" }],
      ),
    );
    expect(code).toContain("// Charges the customer card.");
    expect(code).toContain("// Retries are safe.");
    expect(code.indexOf("// Charges")).toBeLessThan(
      code.indexOf("const Charge"),
    );
  });
});
