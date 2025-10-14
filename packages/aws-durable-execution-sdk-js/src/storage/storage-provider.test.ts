import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
} from "@aws-sdk/client-lambda";
import { ExecutionState } from "./storage-provider";

describe("StorageProvider Interface", () => {
  // Create a mock implementation of the ExecutionState interface
  class MockStorage implements ExecutionState {
    async getStepData(
      _taskToken: string,
      _nextToken: string,
    ): Promise<GetDurableExecutionStateResponse> {
      return { Operations: [] };
    }

    async checkpoint(
      _taskToken: string,
      _data: CheckpointDurableExecutionRequest,
    ): Promise<CheckpointDurableExecutionResponse> {
      return { CheckpointToken: "new-token", NewExecutionState: undefined };
    }
  }

  test("should be able to implement ExecutionState interface", () => {
    const storage = new MockStorage();

    // Verify that the object is an instance of the implementation
    expect(storage).toBeInstanceOf(MockStorage);

    // Verify that the object has the required methods
    expect(typeof storage.getStepData).toBe("function");
    expect(typeof storage.checkpoint).toBe("function");
  });
});
