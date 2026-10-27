import { ExecutionStatus } from "@aws-sdk/client-lambda";
import {
  DurableContext,
  DurableExecutionInvocationInput,
  OperationType,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

// Real time, so that each wait suspends the invocation, and the next
// invocation receives the state.
beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Handler = ReturnType<typeof withDurableExecution>;
type InputOperation = NonNullable<
  DurableExecutionInvocationInput["InitialExecutionState"]
>["Operations"][number];

/**
 * Wraps a durable handler, and records the operations in the input of each
 * invocation.
 */
function recordingInputs(handler: Handler): {
  handler: Handler;
  inputs: InputOperation[][];
} {
  const inputs: InputOperation[][] = [];
  const recording = ((event: DurableExecutionInvocationInput, context) => {
    inputs.push(event.InitialExecutionState?.Operations ?? []);
    return handler(event, context);
  }) as Handler;
  return { handler: recording, inputs };
}

const names = (operations: InputOperation[]): (string | undefined)[] =>
  operations
    .filter((operation) => operation.Type !== OperationType.EXECUTION)
    .map((operation) => operation.Name);

// The service omits every descendant of a completed CONTEXT whose
// ReplayChildren is not true, from the input of later invocations. The SDK
// replays such a context from its result. The local server now omits the same
// operations, so a test sees what the SDK sees in AWS.
describe("child operations of completed contexts in the invocation input", () => {
  it("omits the children of a completed context", async () => {
    const sideEffects: string[] = [];
    const { handler, inputs } = recordingInputs(
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        const total = await context.runInChildContext("sum", async (child) => {
          const a = await child.step("a", async () => {
            sideEffects.push("a");
            return 1;
          });
          const b = await child.step("b", async () => {
            sideEffects.push("b");
            return 2;
          });
          return a + b;
        });
        await context.wait("pause", { seconds: 1 });
        return total;
      }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toBe(3);
    expect(sideEffects).toEqual(["a", "b"]);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    // The second invocation replays "sum" from its result. Its steps are not
    // in the input.
    expect(names(inputs[1])).toEqual(["sum", "pause"]);
    // The test runner still reports every operation.
    expect(runner.getOperation("a").getStepDetails()?.result).toBe(1);
  });

  it("keeps the children of a completed context with ReplayChildren", async () => {
    const sideEffects: string[] = [];
    // A result over the checkpoint size limit makes the SDK close the context
    // with ReplayChildren, and rebuild the result from the children on replay.
    const { handler, inputs } = recordingInputs(
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        const value = await context.runInChildContext(
          "large",
          async (child) => {
            const seed = await child.step("make", async () => {
              sideEffects.push("make");
              return "x";
            });
            return seed.repeat(300 * 1024);
          },
          { summaryGenerator: () => "summary" },
        );
        await context.wait("pause", { seconds: 1 });
        return value.length;
      }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toBe(300 * 1024);
    expect(sideEffects).toEqual(["make"]);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(names(inputs[1])).toEqual(["large", "make", "pause"]);
  });

  it("omits the children of a nested context with ReplayChildren inside a completed context without it", async () => {
    const { handler, inputs } = recordingInputs(
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        // "inner" returns a large result, so it closes with ReplayChildren.
        // "outer" returns its length, so it closes without ReplayChildren.
        const length = await context.runInChildContext(
          "outer",
          async (outer) => {
            const value = await outer.runInChildContext(
              "inner",
              async (inner) => {
                await inner.step("deep", async () => "deep");
                return "x".repeat(300 * 1024);
              },
              { summaryGenerator: () => "summary" },
            );
            return value.length;
          },
        );
        await context.wait("pause", { seconds: 1 });
        return length;
      }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toBe(300 * 1024);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(names(inputs[1])).toEqual(["outer", "pause"]);
  });
});
