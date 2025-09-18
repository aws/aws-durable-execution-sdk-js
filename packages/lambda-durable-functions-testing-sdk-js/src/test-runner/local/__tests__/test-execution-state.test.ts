import { OperationStatus } from "@aws-sdk/client-lambda";
import {
  TestExecutionResult,
  TestExecutionState,
} from "../test-execution-state";

describe("TestExecutionState", () => {
  let executionState: TestExecutionState;

  beforeEach(() => {
    executionState = new TestExecutionState();
  });

  describe("createExecutionPromise", () => {
    it("should create a promise that can be resolved", async () => {
      const mockResult: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "test-result",
      };

      const promise = executionState.createExecutionPromise();
      executionState.resolveWith(mockResult);

      const result = await promise;
      expect(result).toEqual(mockResult);
    });

    it("should create a promise that can be rejected", async () => {
      const mockError = new Error("Test error");

      const promise = executionState.createExecutionPromise();
      executionState.rejectWith(mockError);

      await expect(promise).rejects.toThrow("Test error");
    });

    it("should allow multiple promises to be created", async () => {
      const mockResult1: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "result1",
      };
      const mockResult2: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "result2",
      };

      const promise1 = executionState.createExecutionPromise();
      executionState.resolveWith(mockResult1);

      const result1 = await promise1;
      expect(result1).toEqual(mockResult1);

      // Create a new instance for the second promise
      const executionState2 = new TestExecutionState();
      const promise2 = executionState2.createExecutionPromise();
      executionState2.resolveWith(mockResult2);

      const result2 = await promise2;
      expect(result2).toEqual(mockResult2);
    });
  });

  describe("resolveWith", () => {
    it("should resolve the execution promise with the given result", async () => {
      const mockResult: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      };

      const promise = executionState.createExecutionPromise();
      executionState.resolveWith(mockResult);

      const result = await promise;
      expect(result).toBe(mockResult);
    });

    it("should not throw if called before creating a promise", () => {
      const mockResult: TestExecutionResult = {
        status: OperationStatus.SUCCEEDED,
        result: "test",
      };

      expect(() => {
        executionState.resolveWith(mockResult);
      }).not.toThrow();
    });
  });

  describe("rejectWith", () => {
    it("should reject the execution promise with the given error", async () => {
      const mockError = new Error("Execution failed");

      const promise = executionState.createExecutionPromise();
      executionState.rejectWith(mockError);

      await expect(promise).rejects.toThrow("Execution failed");
    });

    it("should not throw if called before creating a promise", () => {
      const mockError = new Error("Test error");

      expect(() => {
        executionState.rejectWith(mockError);
      }).not.toThrow();
    });
  });
});
