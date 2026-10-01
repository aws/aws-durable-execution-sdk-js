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

// The local checkpoint server rejects an invalid subtype with HTTP 400
// ValidationException, as the service does. The SDK classifies a 4xx
// checkpoint failure as unrecoverable for the execution. So the execution
// fails, as it does in AWS.
describe("subtype validation in the local checkpoint server", () => {
  it.each([
    [
      "over 32 characters",
      "x".repeat(33),
      "Member must have length less than or equal to 32",
    ],
    [
      "outside the pattern",
      "bad subtype!",
      "Member must satisfy regular expression pattern: [a-zA-Z0-9-_]+",
    ],
  ])(
    "fails the execution for a step subtype %s",
    async (_label, subType, constraint) => {
      const after = jest.fn();
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          await context.step("charge", async () => "ok", { subType });
          await context.wait("pause", { seconds: 1 });
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
          `at 'updates.1.member.subType' failed to satisfy constraint: ${constraint}`,
        ),
      });
      expect(after).not.toHaveBeenCalled();
    },
  );

  it("accepts a valid custom subtype", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        context.step("charge", async () => "ok", { subType: "OrderCharge" }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toBe("ok");
  });
});
