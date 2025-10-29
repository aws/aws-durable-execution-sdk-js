import {
  LambdaClient,
  ExecutionStatus,
  Event,
  EventType,
  InvokeCommand,
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetDurableExecutionHistoryCommandOutput,
  GetDurableExecutionCommandOutput,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { CloudDurableTestRunner } from "../cloud-durable-test-runner";

jest.mock("@aws-sdk/client-lambda");

interface MockApiResponses {
  historyResponse?: GetDurableExecutionHistoryCommandOutput;
  executionResponse?: GetDurableExecutionCommandOutput;
  historySequence?: GetDurableExecutionHistoryCommandOutput[];
  executionSequence?: GetDurableExecutionCommandOutput[];
}

describe("CloudDurableTestRunner", () => {
  let mockLambdaClient: jest.Mocked<LambdaClient>;
  let mockSend: jest.Mock;

  const mockFunctionArn =
    "arn:aws:lambda:us-east-1:123456789012:function:test-function";
  const mockExecutionArn =
    "arn:aws:lambda:us-east-1:123456789012:execution:test-execution";

  const mockEvent: Event = {
    EventTimestamp: new Date(),
    EventType: EventType.ExecutionStarted,
    EventId: 1,
    Id: "1",
    ExecutionStartedDetails: {
      Input: {
        Payload: JSON.stringify({
          hello: "world",
        }),
      },
    },
  };

  const setupMockApiResponses = (
    mockSend: jest.Mock,
    responses: MockApiResponses = {},
  ): void => {
    let historyCallCount = 0;
    let executionCallCount = 0;

    mockSend.mockImplementation((command) => {
      if (command instanceof InvokeCommand) {
        return Promise.resolve({ DurableExecutionArn: mockExecutionArn });
      }

      if (command instanceof GetDurableExecutionHistoryCommand) {
        if (responses.historySequence) {
          const response =
            responses.historySequence[historyCallCount] ??
            responses.historySequence[responses.historySequence.length - 1];
          historyCallCount++;
          return Promise.resolve(response);
        }
        return Promise.resolve(
          responses.historyResponse ?? {
            Events: [mockEvent],
            $metadata: {},
          },
        );
      }

      if (command instanceof GetDurableExecutionCommand) {
        if (responses.executionSequence) {
          const response =
            responses.executionSequence[executionCallCount] ??
            responses.executionSequence[responses.executionSequence.length - 1];
          executionCallCount++;
          return Promise.resolve(response);
        }
        return Promise.resolve(
          responses.executionResponse ?? {
            Status: ExecutionStatus.SUCCEEDED,
            Result: '{"success": true}',
            $metadata: {},
          },
        );
      }

      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();

    mockSend = jest.fn();
    mockLambdaClient = {
      send: mockSend,
    } as unknown as jest.Mocked<LambdaClient>;

    (LambdaClient as jest.Mock).mockImplementation(() => mockLambdaClient);

    setupMockApiResponses(mockSend);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Configuration", () => {
    it("should initialize with default configuration", () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      expect(runner).toBeDefined();
      expect(LambdaClient).toHaveBeenCalledWith({});
    });

    it("should initialize with custom Lambda client configuration", () => {
      const customConfig = {
        region: "us-west-2",
        credentials: {
          accessKeyId: "test-key",
          secretAccessKey: "test-secret",
        },
      };

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
        clientConfig: customConfig,
      });

      expect(runner).toBeDefined();
      expect(LambdaClient).toHaveBeenCalledWith(customConfig);
    });

    it("should use custom poll interval", async () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
        config: {
          pollInterval: 2000,
        },
      });

      const runPromise = runner.run();

      await jest.advanceTimersByTimeAsync(1000);
      expect(mockLambdaClient.send).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);
      expect(mockLambdaClient.send).toHaveBeenCalledTimes(3);

      await runPromise;
    });
  });

  describe("run() method", () => {
    it("should execute with payload", async () => {
      setupMockApiResponses(mockSend, {
        executionResponse: {
          Status: ExecutionStatus.SUCCEEDED,
          Result: '{"result": "success"}',
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ result: string }>({
        functionName: mockFunctionArn,
      });

      const testPayload = { input: "test-data", count: 42 };
      const runPromise = runner.run({ payload: testPayload });

      await jest.advanceTimersByTimeAsync(1000);
      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toEqual({ result: "success" });
    });

    it("should execute without payload", async () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const runPromise = runner.run();

      await jest.advanceTimersByTimeAsync(1000);
      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toEqual({ success: true });
    });

    it("should handle invoke failures", async () => {
      mockSend.mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          return Promise.reject(new Error("Failed to invoke function"));
        }
        return Promise.reject(new Error("Unexpected command"));
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      await expect(runner.run()).rejects.toThrow("Failed to invoke function");
    });

    it("should handle failed executions", async () => {
      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [mockEvent],
          $metadata: {},
        },
        executionResponse: {
          Status: ExecutionStatus.FAILED,
          Error: {
            ErrorMessage: "ExecutionFailed",
            ErrorType: "TestError",
          },
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getError()).toEqual({
        errorMessage: "ExecutionFailed",
        errorType: "TestError",
      });
    });
  });

  describe("Operation retrieval", () => {
    it("should retrieve operation by name", async () => {
      const stepEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 1,
        Id: "1",
        Name: "testOperation",
        StepStartedDetails: {},
      };

      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [stepEvent],
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const operation = runner.getOperation("testOperation");

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      await runPromise;

      expect(operation).toBeDefined();
      expect(operation.getOperationData()?.Id).toBe("1");
    });

    it("should retrieve operation by index", async () => {
      const executionEvent: Event = {
        EventType: EventType.ExecutionStarted,
        EventTimestamp: new Date(),
        EventId: 1,
        Id: "1",
        ExecutionStartedDetails: {},
      };
      const stepEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 2,
        Id: "2",
        StepStartedDetails: {},
      };

      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [executionEvent, stepEvent],
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const operation = runner.getOperationByIndex(0);

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      await runPromise;

      expect(operation.getStatus()).toBe(OperationStatus.STARTED);
      expect(operation.getStepDetails()).toBeDefined();
    });

    it("should retrieve operation by name and index", async () => {
      const stepEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 1,
        Id: "1",
        StepStartedDetails: {
          Name: "namedOperation",
          Input: "{}",
        },
      };

      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [stepEvent],
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const operation = runner.getOperationByNameAndIndex("namedOperation", 1);

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      await runPromise;

      expect(operation).toBeDefined();
    });

    it("should retrieve operation by ID", async () => {
      const stepEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 1,
        Id: "op-123",
        StepStartedDetails: {
          Name: "operationById",
          Input: "{}",
        },
      };

      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [stepEvent],
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const operation = runner.getOperationById("op-123");

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      await runPromise;

      expect(operation).toBeDefined();
      expect(operation.getOperationData()?.Id).toBe("op-123");
    });

    it("should handle multiple operation retrievals", async () => {
      const stepEvent1: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 1,
        Id: "op1",
        StepStartedDetails: {
          Name: "operation1",
          Input: "{}",
        },
      };

      const stepEvent2: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 2,
        Id: "op2",
        StepStartedDetails: {
          Name: "operation2",
          Input: "{}",
        },
      };

      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [stepEvent1, stepEvent2],
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const operation1 = runner.getOperationById("op1");
      const operation2 = runner.getOperationById("op2");

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      await runPromise;

      expect(operation1).toBeDefined();
      expect(operation2).toBeDefined();
      expect(operation1.getOperationData()?.Id).toBe("op1");
      expect(operation2.getOperationData()?.Id).toBe("op2");
    });
  });

  describe("Event processing during execution", () => {
    it("should process events during execution", async () => {
      const secondEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.ExecutionSucceeded,
        EventId: 2,
        Id: "2",
        ExecutionSucceededDetails: {
          Result: {
            Payload: JSON.stringify({
              hello: "world",
            }),
          },
        },
      };

      setupMockApiResponses(mockSend, {
        historySequence: [
          {
            Events: [mockEvent],
            $metadata: {},
          },
          {
            Events: [mockEvent, secondEvent],
            $metadata: {},
          },
        ],
        executionSequence: [
          {
            Status: ExecutionStatus.RUNNING,
            $metadata: {},
          },
          {
            Status: ExecutionStatus.SUCCEEDED,
            Result: '{"success": true}',
            $metadata: {},
          },
        ],
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const runPromise = runner.run({ payload: { test: "data" } });

      // First poll
      await jest.advanceTimersByTimeAsync(1000);
      // Second poll
      await jest.advanceTimersByTimeAsync(1000);

      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toBeDefined();
      expect(result.getHistoryEvents()).toHaveLength(2);
    });

    it("should process events across multiple cycles", async () => {
      const secondEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 2,
        Id: "2",
        StepStartedDetails: {},
      };

      setupMockApiResponses(mockSend, {
        historySequence: [
          {
            Events: [mockEvent],
            NextMarker: "marker1",
            $metadata: {},
          },
          {
            Events: [secondEvent],
            NextMarker: "marker2",
            $metadata: {},
          },
          {
            Events: [],
            NextMarker: undefined,
            $metadata: {},
          },
        ],
        executionSequence: [
          {
            Status: ExecutionStatus.RUNNING,
            $metadata: {},
          },
          {
            Status: ExecutionStatus.RUNNING,
            $metadata: {},
          },
          {
            Status: ExecutionStatus.SUCCEEDED,
            Result: '{"success": true}',
            $metadata: {},
          },
        ],
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const runPromise = runner.run();

      // First poll - marker1
      await jest.advanceTimersByTimeAsync(1000);
      // First poll - marker2
      await jest.advanceTimersByTimeAsync(1000);
      // First poll - undefined marker, running execution
      await jest.advanceTimersByTimeAsync(1000);

      // Second poll - running execution
      await jest.advanceTimersByTimeAsync(1000);
      // Third poll - succeeded execution
      await jest.advanceTimersByTimeAsync(1000);

      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toBeDefined();
      expect(result.getHistoryEvents()).toHaveLength(2);
    });

    it("should handle empty events", async () => {
      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [],
          $metadata: {},
        },
        executionResponse: {
          Status: ExecutionStatus.SUCCEEDED,
          Result: '{"success": true}',
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const runPromise = runner.run();

      await jest.advanceTimersByTimeAsync(1000);

      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toBeDefined();
    });

    it("should handle undefined events", async () => {
      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: undefined,
          $metadata: {},
        },
        executionResponse: {
          Status: ExecutionStatus.SUCCEEDED,
          Result: '{"success": true}',
          $metadata: {},
        },
      });

      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
      });

      const runPromise = runner.run();

      await jest.advanceTimersByTimeAsync(1000);

      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toBeDefined();
    });
  });

  describe("Complete execution workflow", () => {
    it("should execute with operations and retrieve data", async () => {
      const stepEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepStarted,
        EventId: 1,
        Id: "1",
        Name: "processData",
        StepStartedDetails: {
          Input: '{"input": "test"}',
        },
      };

      const stepCompletedEvent: Event = {
        EventTimestamp: new Date(),
        EventType: EventType.StepSucceeded,
        EventId: 2,
        Id: "1",
        StepSucceededDetails: {
          Result: {
            Payload: '{"result": "processed"}',
          },
          RetryDetails: {},
        },
      };

      setupMockApiResponses(mockSend, {
        historyResponse: {
          Events: [stepEvent, stepCompletedEvent],
          $metadata: {},
        },
        executionResponse: {
          Status: ExecutionStatus.SUCCEEDED,
          Result: '{"result": "processed"}',
          $metadata: {},
          StartTimestamp: new Date(),
          DurableExecutionArn: "",
          DurableExecutionName: "",
          FunctionArn: "",
        },
      });

      const runner = new CloudDurableTestRunner<{ result: string }>({
        functionName: mockFunctionArn,
      });

      const operation = runner.getOperationByNameAndIndex("processData", 0);

      const runPromise = runner.run();
      await jest.advanceTimersByTimeAsync(1000);
      const result = await runPromise;

      expect(result).toBeDefined();
      expect(result.getResult()).toBeDefined();
      expect(operation.getOperationData()).toEqual({
        Id: "1",
        Name: "processData",
        StartTimestamp: expect.any(Date),
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        EndTimestamp: expect.any(Date),
        StepDetails: {
          Result: '{"result": "processed"}',
        },
      });
    });

    it("should respect custom poll intervals", async () => {
      const runner = new CloudDurableTestRunner<{ success: boolean }>({
        functionName: mockFunctionArn,
        config: {
          pollInterval: 500,
        },
      });

      const runPromise = runner.run();

      await jest.advanceTimersByTimeAsync(400);
      await jest.advanceTimersByTimeAsync(100);

      const result = await runPromise;

      expect(result).toBeDefined();
    });
  });
});
