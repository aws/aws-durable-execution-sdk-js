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
