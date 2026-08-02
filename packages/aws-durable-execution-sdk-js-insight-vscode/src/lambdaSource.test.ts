import { functionRefForState, collectLambdaStates } from "./lambdaSource";

describe("functionRefForState", () => {
  it("returns the FunctionName for a lambda:invoke task", () => {
    expect(
      functionRefForState({
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: { FunctionName: "my-fn" },
      }),
    ).toBe("my-fn");
  });

  it("returns the ARN when the resource is a direct function ARN", () => {
    const arn = "arn:aws:lambda:us-east-1:123:function:foo";
    expect(functionRefForState({ Type: "Task", Resource: arn })).toBe(arn);
  });

  it("returns null for a dynamic FunctionName.$", () => {
    expect(
      functionRefForState({
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: { "FunctionName.$": "$.fn" },
      }),
    ).toBeNull();
  });

  it("returns null for non-lambda tasks", () => {
    expect(
      functionRefForState({
        Type: "Task",
        Resource: "arn:aws:states:::glue:startJobRun.sync",
      }),
    ).toBeNull();
  });
});

describe("collectLambdaStates", () => {
  it("collects lambda tasks including nested branches and map processors", () => {
    const machine = {
      StartAt: "Top",
      States: {
        Top: {
          Type: "Parallel",
          Branches: [
            {
              StartAt: "L1",
              States: {
                L1: {
                  Type: "Task",
                  Resource: "arn:aws:states:::lambda:invoke",
                  Parameters: { FunctionName: "fn1" },
                  End: true,
                },
              },
            },
          ],
          Next: "Loop",
        },
        Loop: {
          Type: "Map",
          ItemProcessor: {
            StartAt: "L2",
            States: {
              L2: {
                Type: "Task",
                Resource: "arn:aws:lambda:us-east-1:1:function:fn2",
                End: true,
              },
            },
          },
          End: true,
        },
      },
    };
    const found = collectLambdaStates(machine);
    expect(found.get("L1")).toBe("fn1");
    expect(found.get("L2")).toBe("arn:aws:lambda:us-east-1:1:function:fn2");
    expect(found.has("Top")).toBe(false);
  });
});
