import { aslToSkeleton, translateJsonPath } from "./aslSkeleton";
import { qualifyFunctionRef } from "./aslSkeleton";
import { transform } from "esbuild";
import {
  generateHandler,
  parseWorkflow,
} from "@aws/durable-execution-sdk-js-cdk";

describe("translateJsonPath", () => {
  it("maps $ to input and reference paths to member access", () => {
    expect(translateJsonPath("$")).toBe("input");
    expect(translateJsonPath("$.foo.bar")).toBe("input.foo.bar");
    expect(translateJsonPath("$.items[0].id")).toBe("input.items[0].id");
  });

  it("leaves JSONata / intrinsics / context as a TODO marker", () => {
    expect(translateJsonPath("$$.Execution.Id")).toContain("TODO translate");
    expect(translateJsonPath("States.Format('{}', $.x)")).toContain(
      "TODO translate",
    );
  });
});

const SAMPLE_ASL = JSON.stringify({
  Comment: "Sample",
  StartAt: "DoWork",
  States: {
    DoWork: {
      Type: "Task",
      Resource: "arn:aws:states:::dynamodb:getItem",
      Next: "Decide",
    },
    Decide: {
      Type: "Choice",
      Choices: [{ Variable: "$.ok", BooleanEquals: true, Next: "Wait5" }],
      Default: "Fail1",
    },
    Wait5: { Type: "Wait", Seconds: 5, Next: "Fan" },
    Fan: {
      Type: "Parallel",
      Branches: [
        {
          StartAt: "B1",
          States: { B1: { Type: "Pass", End: true } },
        },
      ],
      Next: "Done",
    },
    Done: { Type: "Succeed" },
    Fail1: { Type: "Fail" },
  },
});

describe("aslToSkeleton", () => {
  const { workflow, todos, notes } = aslToSkeleton(JSON.parse(SAMPLE_ASL));

  it("adds a start node wired to StartAt", () => {
    const start = workflow.nodes.find((n) => n.kind === "start");
    expect(start).toBeTruthy();
    expect(
      workflow.edges.some((e) => e.source === "start" && e.target === "DoWork"),
    ).toBe(true);
  });

  it("maps each state Type to the right node kind", () => {
    const kind = (id: string) => workflow.nodes.find((n) => n.id === id)?.kind;
    expect(kind("DoWork")).toBe("step");
    expect(kind("Decide")).toBe("condition");
    expect(kind("Wait5")).toBe("wait");
    expect(kind("Fan")).toBe("parallel");
    expect(kind("Done")).toBe("end");
    expect(kind("Fail1")).toBe("end");
    // Succeed and Fail are both `end` nodes, but they must not behave the same:
    // without endMode, codegen emits a `return`, so an imported Fail reported the
    // execution as SUCCEEDED.
    const fail1 = workflow.nodes.find((n) => n.id === "Fail1");
    const done = workflow.nodes.find((n) => n.id === "Done");
    expect(fail1?.endMode).toBe("throw");
    expect(done?.endMode).toBeUndefined();
  });

  it("labels choice edges with the target and leaves the default unlabeled", () => {
    const out = workflow.edges.filter((e) => e.source === "Decide");
    const labeled = out.find((e) => e.target === "Wait5");
    const dflt = out.find((e) => e.target === "Fail1");
    expect(labeled?.match).toBe("Wait5");
    expect(dflt?.match).toBeUndefined();
  });

  it("builds parallel branches with a nested body", () => {
    const fan = workflow.nodes.find((n) => n.id === "Fan");
    const branches = fan?.branches as { body: { nodes: unknown[] } }[];
    expect(branches).toHaveLength(1);
    expect(branches[0].body.nodes.length).toBeGreaterThan(0);
  });

  it("maps Pass states to inline nodes (pure transform, no checkpoint)", () => {
    const fan = workflow.nodes.find((n) => n.id === "Fan");
    const branches = fan?.branches as {
      body: { nodes: { id: string; kind: string }[] };
    }[];
    const b1 = branches[0].body.nodes.find((n) => n.id === "B1");
    expect(b1?.kind).toBe("inline");
  });

  it("classifies service integrations and lambda invokes", () => {
    const asl = {
      StartAt: "A",
      States: {
        A: {
          Type: "Task",
          Resource: "arn:aws:states:::glue:startJobRun.sync",
          Next: "B",
        },
        B: {
          Type: "Task",
          Resource: "arn:aws:states:::lambda:invoke",
          Next: "C",
        },
        C: {
          Type: "Task",
          Resource: "arn:aws:states:::sns:publish.waitForTaskToken",
          End: true,
        },
      },
    };
    const sk = aslToSkeleton(asl);
    const kind = (id: string) =>
      sk.workflow.nodes.find((n) => n.id === id)?.kind;
    expect(kind("A")).toBe("awsJob");
    expect(kind("B")).toBe("chainInvoke");
    expect(kind("C")).toBe("callback");
  });

  it("emits code todos for step / choice bodies", () => {
    expect(todos.some((t) => t.nodeId === "DoWork" && t.field === "code")).toBe(
      true,
    );
    expect(
      todos.some((t) => t.nodeId === "Decide" && t.kind === "condition"),
    ).toBe(true);
  });

  it("notes are an array", () => {
    expect(Array.isArray(notes)).toBe(true);
  });

  it("produces a workflow whose stub bodies generate + transpile", async () => {
    const parsed = parseWorkflow(JSON.parse(JSON.stringify(workflow)));
    const handler = generateHandler(parsed);
    expect(handler).toContain("withDurableExecution");
    // The generated TypeScript must be syntactically valid.
    const out = await transform(handler, { loader: "ts", format: "cjs" });
    expect(out.code.length).toBeGreaterThan(0);
  });
});

describe("qualifyFunctionRef", () => {
  it("appends :$LATEST to an unqualified bare name", () => {
    expect(qualifyFunctionRef("my-fn")).toBe("my-fn:$LATEST");
  });
  it("keeps an already-qualified name/alias", () => {
    expect(qualifyFunctionRef("my-fn:prod")).toBe("my-fn:prod");
    expect(qualifyFunctionRef("my-fn:12")).toBe("my-fn:12");
  });
  it("qualifies an unqualified function ARN", () => {
    expect(
      qualifyFunctionRef("arn:aws:lambda:us-east-2:1:function:my-fn"),
    ).toBe("arn:aws:lambda:us-east-2:1:function:my-fn:$LATEST");
  });
  it("keeps a qualified function ARN", () => {
    const q = "arn:aws:lambda:us-east-2:1:function:my-fn:1";
    expect(qualifyFunctionRef(q)).toBe(q);
  });
});

describe("aslToSkeleton chainInvoke qualification", () => {
  it("qualifies the invoke target for a lambda:invoke task", () => {
    const sk = aslToSkeleton({
      StartAt: "Inv",
      States: {
        Inv: {
          Type: "Task",
          Resource: "arn:aws:states:::lambda:invoke",
          Parameters: { FunctionName: "dar-import-test-fn" },
          End: true,
        },
      },
    });
    const node = sk.workflow.nodes.find((n) => n.id === "Inv");
    expect(node?.kind).toBe("chainInvoke");
    expect(node?.functionArn).toBe("dar-import-test-fn:$LATEST");
  });
});

describe("aslToSkeleton with inline Lambda sources", () => {
  const asl = {
    StartAt: "Invoke",
    States: {
      Invoke: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: { FunctionName: "my-fn", Payload: { a: 1 } },
        End: true,
      },
    },
  };

  it("keeps a lambda task as chainInvoke when not inlined", () => {
    const sk = aslToSkeleton(asl);
    expect(sk.workflow.nodes.find((n) => n.id === "Invoke")?.kind).toBe(
      "chainInvoke",
    );
    expect(sk.todos.some((t) => t.nodeId === "Invoke")).toBe(false);
  });

  it("imports it as a step (with source in the todo) when inlined", () => {
    const sk = aslToSkeleton(asl, {
      inlineSources: new Map([
        [
          "Invoke",
          {
            handler: "index.handler",
            source: "exports.handler = async () => 42;",
          },
        ],
      ]),
    });
    expect(sk.workflow.nodes.find((n) => n.id === "Invoke")?.kind).toBe("step");
    const todo = sk.todos.find((t) => t.nodeId === "Invoke");
    expect(todo?.field).toBe("code");
    expect(todo?.description).toContain("index.handler");
    expect(todo?.description).toContain("exports.handler");
    // A review note about IAM/env not being imported.
    expect(sk.notes.some((n) => n.includes("inlined from Lambda"))).toBe(true);
  });
});

describe("aslToSkeleton — Catch clauses", () => {
  it("maps Catch to error-kind edges (routing on edges, not nodes)", () => {
    const sk = aslToSkeleton({
      StartAt: "Work",
      States: {
        Work: {
          Type: "Task",
          Resource: "arn:aws:states:::dynamodb:getItem",
          Catch: [
            { ErrorEquals: ["States.Timeout"], Next: "OnTimeout" },
            { ErrorEquals: ["States.ALL"], Next: "OnAny" },
          ],
          End: true,
        },
        OnTimeout: { Type: "Succeed" },
        OnAny: { Type: "Succeed" },
      },
    });
    const errEdges = sk.workflow.edges.filter((e) => e.kind === "error");
    expect(errEdges).toHaveLength(2);
    // errorType becomes `err instanceof <Type>` in generated code, so it has to
    // name a real JavaScript class. "States.Timeout" is an ASL error NAME, not a
    // class — asserting it here previously locked in code that throws a
    // ReferenceError at runtime. It is now dropped (making the edge a catch-all)
    // and reported through `notes`.
    expect(errEdges[0]).toMatchObject({ source: "Work", target: "OnTimeout" });
    expect(errEdges[0].errorType).toBeUndefined();
    expect(sk.notes.some((n) => n.includes("States.Timeout"))).toBe(true);
    expect(errEdges[1]).toMatchObject({ source: "Work", target: "OnAny" });
    // No node-owned routing remains.
    const work = sk.workflow.nodes.find((n) => n.id === "Work");
    expect(work?.onError ?? []).toHaveLength(0);
  });
});

describe("aslToSkeleton — Comment and dynamic Wait", () => {
  it("maps machine and state Comments, and SecondsPath to durationCode", () => {
    const sk = aslToSkeleton({
      Comment: "Order pipeline",
      StartAt: "Hold",
      States: {
        Hold: {
          Type: "Wait",
          Comment: "Pause before retrying",
          SecondsPath: "$.retryAfter",
          End: true,
        },
      },
    });
    expect(sk.workflow.comment).toBe("Order pipeline");
    const hold = sk.workflow.nodes.find((n) => n.id === "Hold")!;
    expect(hold.comment).toBe("Pause before retrying");
    expect(hold.durationCode).toBe("return input.retryAfter;");
    // No "defaulted to 1s" note for a SecondsPath wait.
    expect(sk.notes.some((n) => n.includes("Hold"))).toBe(false);
  });
});

describe("aslToSkeleton Retry translation", () => {
  it("translates a Task Retry policy into node.retry", () => {
    const { workflow, notes } = aslToSkeleton({
      StartAt: "DoWork",
      States: {
        DoWork: {
          Type: "Task",
          Resource: "arn:aws:states:::dynamodb:getItem",
          End: true,
          Retry: [
            {
              ErrorEquals: ["States.ALL"],
              IntervalSeconds: 2,
              MaxAttempts: 5,
              BackoffRate: 3,
              MaxDelaySeconds: 60,
            },
          ],
        },
      },
    });
    const node = workflow.nodes.find((n) => n.name === "DoWork")!;
    expect(node.retry).toEqual({
      kind: "exponential",
      maxAttempts: 5,
      initialDelaySeconds: 2,
      maxDelaySeconds: 60,
      backoffRate: 3,
      incrementSeconds: 1,
      jitter: "FULL",
    });
    expect(notes.join("\n")).not.toMatch(/import its retry strategy manually/);
  });

  it("imports the first retrier and notes the rest when there are several", () => {
    const { workflow, notes } = aslToSkeleton({
      StartAt: "DoWork",
      States: {
        DoWork: {
          Type: "Task",
          Resource: "arn:aws:states:::dynamodb:getItem",
          End: true,
          Retry: [
            { ErrorEquals: ["States.Timeout"], MaxAttempts: 2 },
            { ErrorEquals: ["States.ALL"], MaxAttempts: 5 },
          ],
        },
      },
    });
    const node = workflow.nodes.find((n) => n.name === "DoWork")!;
    expect((node.retry as { maxAttempts: number }).maxAttempts).toBe(2);
    expect(notes.join("\n")).toMatch(/2 Retry policies.*only the first/);
  });
});

describe("aslToSkeleton Map concurrency/tolerance translation", () => {
  it("imports MaxConcurrency and ToleratedFailure* onto the map node", () => {
    const { workflow } = aslToSkeleton({
      StartAt: "Fan",
      States: {
        Fan: {
          Type: "Map",
          ItemsPath: "$.items",
          MaxConcurrency: 4,
          ToleratedFailureCount: 2,
          ToleratedFailurePercentage: 10,
          ItemProcessor: {
            StartAt: "Item",
            States: { Item: { Type: "Pass", End: true } },
          },
          End: true,
        },
      },
    });
    const node = workflow.nodes.find((n) => n.name === "Fan")!;
    expect(node.maxConcurrency).toBe(4);
    expect(node.toleratedFailureCount).toBe(2);
    expect(node.toleratedFailurePercentage).toBe(10);
  });

  it("leaves the fields unset when ASL doesn't specify them", () => {
    const { workflow } = aslToSkeleton({
      StartAt: "Fan",
      States: {
        Fan: {
          Type: "Map",
          ItemsPath: "$.items",
          ItemProcessor: {
            StartAt: "Item",
            States: { Item: { Type: "Pass", End: true } },
          },
          End: true,
        },
      },
    });
    const node = workflow.nodes.find((n) => n.name === "Fan")!;
    expect(node.maxConcurrency).toBeUndefined();
    expect(node.toleratedFailureCount).toBeUndefined();
    expect(node.toleratedFailurePercentage).toBeUndefined();
  });
});
