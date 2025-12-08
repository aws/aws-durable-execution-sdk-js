import {
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./serde-basic";

createTests({
  name: "serde-basic test",
  functionName: "serde-basic",
  handler,
  tests: (runner) => {
    it("should preserve User class methods across replay with createClassSerdes", async () => {
      const execution = await runner.run({
        payload: {
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@example.com",
        },
      });

      // Verify at least 2 invocations (initial + replay after wait)
      expect(execution.getInvocations().length).toBe(2);

      // Verify we have 3 operations: create-user step, wait, greet-user step
      expect(execution.getOperations().length).toBe(3);

      // Verify first step (create-user) succeeded
      const createUserStep = runner.getOperation("create-user");
      expect(createUserStep).toBeDefined();
      expect(createUserStep.getType()).toBe(OperationType.STEP);
      expect(createUserStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const stepResult = createUserStep.getStepDetails()?.result as any;
      expect(stepResult.firstName).toBe("John");
      expect(stepResult.lastName).toBe("Doe");
      expect(stepResult.email).toBe("john.doe@example.com");

      // Verify wait operation exists
      const waitOp = runner.getOperationByIndex(1);
      expect(waitOp.getType()).toBe(OperationType.WAIT);
      expect(waitOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Verify second step (greet-user) succeeded
      const greetUserStep = runner.getOperation("greet-user");
      expect(greetUserStep).toBeDefined();
      expect(greetUserStep.getType()).toBe(OperationType.STEP);
      expect(greetUserStep.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(greetUserStep.getStepDetails()?.error).toBeUndefined();
      expect(greetUserStep.getStepDetails()?.result).toBe(
        "Hello, I'm John Doe. My email is john.doe@example.com",
      );

      // Verify final result
      const result = execution.getResult() as any;
      expect(result.user.firstName).toBe("John");
      expect(result.user.lastName).toBe("Doe");
      expect(result.user.email).toBe("john.doe@example.com");
      expect(result.greeting).toBe(
        "Hello, I'm John Doe. My email is john.doe@example.com",
      );
    });

    it("should work with different user data", async () => {
      const execution = await runner.run({
        payload: {
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@example.com",
        },
      });

      // Verify the greeting was generated correctly using class methods
      const result = execution.getResult() as any;
      expect(result.greeting).toBe(
        "Hello, I'm Alice Smith. My email is alice@example.com",
      );

      // Verify all operations succeeded
      const createUserStep = runner.getOperation("create-user");
      const greetUserStep = runner.getOperation("greet-user");
      expect(createUserStep.getStepDetails()?.error).toBeUndefined();
      expect(greetUserStep.getStepDetails()?.error).toBeUndefined();

      // This proves createClassSerdes successfully preserved the User class methods
      // during deserialization after the wait/replay
    });
  },
});
