import { ExecutionStatus } from "@aws-sdk/client-lambda";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

// The service accepts an operation name of 1 to 256 printable ASCII
// characters. It rejects any other name with HTTP 400 ValidationException.
// The SDK classifies a 4xx checkpoint failure as unrecoverable for the
// execution. So the execution fails in AWS, and the local server makes it
// fail the same way.
describe("operation name validation in the local checkpoint server", () => {
  it.each([
    [
      "with a character outside printable ASCII",
      "café",
      "Member must satisfy regular expression pattern: [\\x20-\\x7E]+",
    ],
    [
      "over 256 characters",
      "n".repeat(257),
      "Member must have length less than or equal to 256",
    ],
  ])(
    "fails the execution for a step name %s",
    async (_label, name, constraint) => {
      const after = jest.fn();
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          await context.step(name, async () => "ok");
          after();
          return "done";
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });

      const result = await runner.run();

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(result.getError()).toMatchObject({
        errorType: "CheckpointUnrecoverableExecutionError",
        errorMessage: expect.stringContaining(
          `at 'updates.1.member.name' failed to satisfy constraint: ${constraint}`,
        ),
      });
      expect(after).not.toHaveBeenCalled();
    },
  );

  it("accepts a printable ASCII name", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        context.step("charge card #1 (retry: ~2)", async () => "ok"),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toBe("ok");
  });
});

// The service requires ChainedInvokeOptions.FunctionName to be a Lambda
// function name, a qualified name, or a function ARN. It rejects any other
// value with HTTP 400 ValidationException. So the execution fails in AWS
// before any function runs, and the local server makes it fail the same way.
describe("chained invoke function name validation in the local checkpoint server", () => {
  it.each([
    [
      "an empty function name",
      "",
      "Value '' at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must have length greater than or equal to 1",
    ],
    [
      "a function name outside the pattern",
      "bad name!",
      "Value 'bad name!' at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must satisfy regular expression pattern:",
    ],
  ])("fails the execution for %s", async (_label, functionName, error) => {
    const child = jest.fn(async () => "child result");
    const after = jest.fn();
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.invoke("call child", functionName, {});
        after();
        return "done";
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFunction(functionName, child);

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(result.getError()).toMatchObject({
      errorType: "CheckpointUnrecoverableExecutionError",
      errorMessage: expect.stringContaining(error),
    });
    expect(child).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});

// The SDK copies the `message` of a thrown error-like object into
// `ErrorMessage` as it is. The service reads `ErrorMessage` as a string. So a
// numeric `message` fails the checkpoint with HTTP 400
// SerializationException, and the execution fails in AWS. The local server
// makes it fail the same way.
describe("error object type validation in the local checkpoint server", () => {
  it("fails the execution for a thrown object with a numeric message", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        context.step("charge", async () => {
          // biome-ignore lint/style/useThrowOnlyError: the test throws an error-like object on purpose, to reach the SDK's error-like path.
          throw { name: "ChargeError", message: 1 };
        }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(result.getError()).toMatchObject({
      errorType: "CheckpointUnrecoverableExecutionError",
      errorMessage: expect.stringContaining(
        "NUMBER_VALUE can not be converted to a String",
      ),
    });
  });
});

// The service reads an integer member without its fractional part, and then
// applies that integer. So `context.wait({ seconds: 1.5 })` waits 1 second in
// AWS, and records 1 second. The local server stores and schedules the same
// integer.
describe("integer members in the local checkpoint server", () => {
  it("records a wait of 1.5 seconds as 1 second", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.wait("pause", { seconds: 1.5 });
        return "done";
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(runner.getOperation("pause").getWaitDetails()?.waitSeconds).toBe(1);
  });
});
