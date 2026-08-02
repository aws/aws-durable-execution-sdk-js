import { aslToSkeleton } from "./aslSkeleton";
import { generateHandler } from "@aws/durable-execution-sdk-js-cdk";
import type { AslStateMachine } from "./aslSkeleton";

/**
 * ASL import fidelity. Each of these was silent: the import produced a workflow
 * that looked right on the canvas and behaved differently at runtime.
 */
const build = (states: Record<string, unknown>, startAt = "T") =>
  aslToSkeleton({ StartAt: startAt, States: states } as AslStateMachine);

describe("ASL Fail states actually fail", () => {
  const sk = build({
    T: { Type: "Fail", Error: "BadThing", Cause: "it broke" },
  });
  const code = generateHandler(sk.workflow as never);

  it("throws rather than returning", () => {
    // Succeed and Fail both mapped to a bare `end`, and a missing endMode makes
    // codegen emit a `return` — so every imported Fail reported SUCCEEDED.
    expect(code).toContain("throw");
    expect(code).not.toMatch(/return undefined;\s*$/);
  });

  it("preserves Error and Cause, which were dropped entirely", () => {
    expect(code).toContain("BadThing");
    expect(code).toContain("it broke");
  });

  it("still treats Succeed as a success", () => {
    const ok = build({ T: { Type: "Succeed" } });
    expect(generateHandler(ok.workflow as never)).not.toContain(
      "throw new Error",
    );
  });
});

describe("ASL catch error names", () => {
  it("never emits an instanceof against an ASL error name", () => {
    // `err instanceof States.Timeout` is a ReferenceError at runtime: ASL error
    // names are not JavaScript classes.
    const sk = build({
      T: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Next: "S",
        Catch: [{ ErrorEquals: ["States.Timeout"], Next: "H" }],
      },
      S: { Type: "Succeed" },
      H: { Type: "Succeed" },
    });
    const code = generateHandler(sk.workflow as never);
    expect(code).not.toContain("instanceof States.");
    expect(sk.notes.some((n) => n.includes("States.Timeout"))).toBe(true);
  });

  it("treats States.ALL as a catch-all, not a type", () => {
    const sk = build({
      T: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Next: "S",
        Catch: [{ ErrorEquals: ["States.ALL"], Next: "H" }],
      },
      S: { Type: "Succeed" },
      H: { Type: "Succeed" },
    });
    const edge = sk.workflow.edges.find((e) => e.kind === "error");
    expect(edge?.errorType).toBeUndefined();
    expect(generateHandler(sk.workflow as never)).not.toContain(
      "instanceof States.ALL",
    );
  });

  it("keeps a custom error name, which plausibly is the thrown class", () => {
    const sk = build({
      T: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Next: "S",
        Catch: [{ ErrorEquals: ["MyCustomError"], Next: "H" }],
      },
      S: { Type: "Succeed" },
      H: { Type: "Succeed" },
    });
    expect(sk.workflow.edges.find((e) => e.kind === "error")?.errorType).toBe(
      "MyCustomError",
    );
  });
});

describe("ASL dropped fields are reported", () => {
  it.each([
    ["ResultPath", { ResultPath: "$.out" }],
    ["InputPath", { InputPath: "$.in" }],
    ["OutputPath", { OutputPath: "$.out" }],
    ["ResultSelector", { ResultSelector: { a: "$.b" } }],
    ["TimeoutSeconds", { TimeoutSeconds: 30 }],
    ["HeartbeatSeconds", { HeartbeatSeconds: 5 }],
  ])("warns about %s instead of dropping it silently", (field, extra) => {
    const sk = build({
      T: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        End: true,
        ...extra,
      },
    });
    expect(sk.notes.some((n) => n.includes(field))).toBe(true);
  });

  it("warns that JSONata is not understood", () => {
    const sk = build({
      T: {
        Type: "Task",
        QueryLanguage: "JSONata",
        Resource: "arn:aws:states:::lambda:invoke",
        End: true,
      },
    });
    expect(sk.notes.some((n) => n.includes("JSONata"))).toBe(true);
  });

  it("warns that Retry/Catch on a non-Task state are lost", () => {
    // Retry/Catch are handled only inside the Task case, so Map/Parallel error
    // handling vanished without a word.
    const sk = build({
      T: {
        Type: "Parallel",
        Branches: [],
        End: true,
        Catch: [{ ErrorEquals: ["States.ALL"], Next: "T" }],
      },
    });
    expect(sk.notes.some((n) => n.includes("Retry/Catch"))).toBe(true);
  });
});
