import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./steps-with-retry";

// Mock AWS SDK to return successful responses
var mockSend: jest.Mock;
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => {
    const localMockSend = jest.fn();
    mockSend = localMockSend;
    return {
      send: localMockSend,
    };
  }),
  GetItemCommand: jest.fn().mockImplementation((params) => params),
}));

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("steps-with-retry", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
  });

  jest.spyOn(Math, "random").mockReturnValue(0.5);

  beforeEach(() => {
    mockSend.mockClear();
  });

  it("should successfully execute when DynamoDB returns an item on first try", async () => {
    // Mock successful DynamoDB response
    mockSend.mockResolvedValue({
      Item: {
        id: { S: "test-item" },
        data: { S: "test-data" },
      },
    });

    const execution = await durableTestRunner.run();

    // Verify the execution completed successfully
    const result = execution.getResult();
    expect(result).toEqual({
      id: { S: "test-item" },
      data: { S: "test-data" },
    });

    // Verify that the step operation was executed
    const stepOp = durableTestRunner.getOperationByIndex(0);
    expect(stepOp.getStepDetails()?.result).toBeDefined();
  });

  it("should handle polling when item is not found initially", async () => {
    // Mock DynamoDB to return empty first, then success
    mockSend
      .mockResolvedValueOnce({ Item: undefined }) // First poll - no item
      .mockResolvedValue({
        Item: {
          id: { S: "test-item" },
          data: { S: "found-item" },
        },
      }); // Second poll - item found

    const execution = await durableTestRunner.run();

    // Should succeed after polling
    const result = execution.getResult();
    expect(result).toEqual({
      id: { S: "test-item" },
      data: { S: "found-item" },
    });

    // Verify wait operation was called (1 second wait between polls)
    const waitOp = durableTestRunner.getOperationByIndex(1);
    expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(1);
  });

  it("should retry failed DynamoDB calls according to retry strategy", async () => {
    // Mock DynamoDB to fail once, then succeed
    mockSend
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValue({
        Item: {
          id: { S: "test-item" },
          data: { S: "retry-success" },
        },
      });

    const execution = await durableTestRunner.run();

    // Should eventually succeed after retry
    const result = execution.getResult();
    expect(result).toEqual({
      id: { S: "test-item" },
      data: { S: "retry-success" },
    });

    // Verify that the step operation handled the retry
    const stepOp = durableTestRunner.getOperationByIndex(0);
    expect(stepOp).toBeDefined();
  });

  it("should fail after exhausting retry attempts", async () => {
    // Mock DynamoDB to always fail
    mockSend.mockRejectedValue(new Error("Persistent failure"));

    // Execution result returns StepError
    const expectedExecutionError = {
      errorMessage: "Persistent failure",
      errorType: "StepError",
      errorData: undefined,
      stackTrace: undefined,
    };

    // Step details contain original Error
    const expectedStepError = {
      errorMessage: "Persistent failure",
      errorType: "Error",
      stackTrace: undefined,
    };

    const result = await durableTestRunner.run();
    const error = result.getError();
    expect(error).toEqual(expectedExecutionError);

    // Verify that step operations were attempted
    const stepOp = durableTestRunner.getOperationByIndex(0);
    expect(stepOp.getStepDetails()?.result).toBeUndefined();
    expect(stepOp.getStepDetails()?.error).toEqual(expectedStepError);
  });

  it("should fail when item is not found after maximum polls", async () => {
    // Mock DynamoDB to always return empty (no item found)
    mockSend.mockResolvedValue({ Item: undefined });

    const result = await durableTestRunner.run();
    const error = result.getError();
    expect(error).toEqual({
      errorMessage: "Item Not Found",
      errorType: "Error",
      stackTrace: undefined,
    });

    // Verify that multiple operations were created for polling
    const firstStepOp = durableTestRunner.getOperationByIndex(0);
    expect(firstStepOp.getStepDetails()?.result).toBeDefined();

    // Should have wait operations between polls
    const waitOp = durableTestRunner.getOperationByIndex(1);
    expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(1);
  });
});
