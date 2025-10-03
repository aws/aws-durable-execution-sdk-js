import { TestExecutionOrchestrator } from "../test-execution-orchestrator";
import { LocalOperationStorage } from "../operations/local-operation-storage";
import {
  createCheckpointToken,
  createExecutionId,
  createInvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";
import {
  DurableExecutionInvocationOutput,
  InvocationStatus,
} from "@aws/durable-execution-sdk-js";
import {
  ErrorObject,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { OperationWaitManager } from "../operations/operation-wait-manager";
import { CheckpointApiClient } from "../api-client/checkpoint-api-client";
import { IndexedOperations } from "../../common/indexed-operations";
import { OperationWithData } from "../../common/operations/operation-with-data";
import { Scheduler } from "../orchestration/scheduler";
import { CheckpointOperation } from "../../../checkpoint-server/storage/checkpoint-manager";
import { FunctionStorage } from "../operations/function-storage";
import { ILocalDurableTestRunnerFactory } from "../interfaces/durable-test-runner-factory";
import { DurableApiClient } from "../../common/create-durable-api-client";

// Mock dependencies
jest.mock("../operations/local-operation-storage");

const mockInvoke = jest.fn();

jest.mock("../invoke-handler", () => ({
  InvokeHandler: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
  })),
}));

describe("TestExecutionOrchestrator", () => {
  const mockHandlerFunction = jest.fn();
  const mockExecutionId = createExecutionId("test-execution-id");
  const mockCheckpointToken = createCheckpointToken("test-checkpoint-token");

  let orchestrator: TestExecutionOrchestrator;
  let mockOperationStorage: jest.Mocked<LocalOperationStorage>;
  let checkpointApi: CheckpointApiClient;
  let mockScheduler: Scheduler;
  let mockFunctionStorage: FunctionStorage;
  let mockDurableApiClient: DurableApiClient;

  const mockOperation: Operation = {
    Id: "op1",
    Name: "operation1",
    Type: OperationType.STEP,
    Status: OperationStatus.SUCCEEDED,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDurableApiClient = {
      sendCallbackFailure: jest.fn(),
      sendCallbackSuccess: jest.fn(),
      sendCallbackHeartbeat: jest.fn(),
    };
    // Mock OperationStorage
    mockOperationStorage = new LocalOperationStorage(
      new OperationWaitManager(),
      new IndexedOperations([]),
      mockDurableApiClient,
      jest.fn()
    ) as jest.Mocked<LocalOperationStorage>;
    mockOperationStorage.populateOperations = jest.fn();

    checkpointApi = new CheckpointApiClient("http://127.0.0.1:1234");

    mockScheduler = new Scheduler();

    // Create a mock factory for FunctionStorage
    const mockFactory: ILocalDurableTestRunnerFactory = {
      createRunner: jest.fn().mockReturnValue({
        run: jest.fn().mockResolvedValue({
          getStatus: () => "SUCCEEDED",
          getResult: () => ({}),
        }),
      }),
    };

    mockFunctionStorage = new FunctionStorage(mockFactory);

    jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
      executionId: mockExecutionId,
      checkpointToken: mockCheckpointToken,
      operations: [mockOperation],
      invocationId: createInvocationId(),
    });

    jest.spyOn(checkpointApi, "pollCheckpointData").mockResolvedValue({
      operations: [],
      operationInvocationIdMap: {},
    });

    jest
      .spyOn(checkpointApi, "updateCheckpointData")
      .mockResolvedValue(undefined);

    jest.spyOn(checkpointApi, "startInvocation").mockResolvedValue({
      checkpointToken: createCheckpointToken("new-token"),
      executionId: createExecutionId(),
      invocationId: createInvocationId(),
      operations: [],
    });

    const mockInvocationResult = {
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify({ success: true }),
    } satisfies DurableExecutionInvocationOutput;

    mockInvoke.mockResolvedValue(mockInvocationResult);

    orchestrator = new TestExecutionOrchestrator(
      mockHandlerFunction,
      mockOperationStorage,
      checkpointApi,
      mockScheduler,
      mockFunctionStorage,
      false // skipTime
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function terminateExecution({
    status = OperationStatus.SUCCEEDED,
    result = "",
    error,
  }: { status?: OperationStatus; result?: string; error?: ErrorObject } = {}) {
    (checkpointApi.pollCheckpointData as jest.Mock).mockResolvedValueOnce({
      operations: [
        {
          operation: {
            Id: "execution-id",
            Type: OperationType.EXECUTION,
            Status: status,
          },
          update: {
            Id: "execution-id",
            Type: OperationType.EXECUTION,
            Action:
              status === OperationStatus.SUCCEEDED
                ? OperationAction.SUCCEED
                : OperationAction.FAIL,
            Payload: result,
            Error: error,
          },
          events: [],
        },
      ] satisfies CheckpointOperation[],
      operationInvocationIdMap: {
        "execution-id": createInvocationId("execution-invocation"),
      },
    });
  }

  describe("executeHandler", () => {
    it("should execute handler and return result on completion", async () => {
      const result = await orchestrator.executeHandler({
        payload: { input: "test" },
      });

      expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
        JSON.stringify({
          input: "test",
        })
      );
      expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
        durableExecutionArn: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [mockOperation],
      });
      expect(result).toEqual({
        status: OperationStatus.SUCCEEDED,
        result: JSON.stringify({ success: true }),
      });
    });

    describe("execution checkpoint", () => {
      it("should resolve execution with succeeded result when the execution update occurs", async () => {
        const mockOperations = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.SUCCEEDED,
            },
            update: {
              Id: "op1",
              Type: OperationType.EXECUTION,
              Name: "operation1",
              Payload: "execution-result",
              Action: OperationAction.SUCCEED,
            },
            events: [],
          },
        ] satisfies CheckpointOperation[];

        (checkpointApi.pollCheckpointData as jest.Mock)
          .mockResolvedValueOnce({
            operations: mockOperations,
            operationInvocationIdMap: {
              op1: [createInvocationId("test-invocation")],
            },
          })
          .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

        const result = await orchestrator.executeHandler({
          payload: { input: "test" },
        });

        expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
          JSON.stringify({
            input: "test",
          })
        );
        mockInvoke.mockResolvedValue({
          Status: InvocationStatus.SUCCEEDED,
        });
        expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
          durableExecutionArn: mockExecutionId,
          checkpointToken: mockCheckpointToken,
          operations: [mockOperation],
        });
        expect(result).toEqual({
          status: OperationStatus.SUCCEEDED,
          result: "execution-result",
        });
      });

      it("should resolve execution with failed result when the execution update occurs", async () => {
        const mockOperations = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.FAILED,
            },
            update: {
              Id: "op1",
              Type: OperationType.EXECUTION,
              Name: "operation1",
              Error: {
                ErrorMessage: "my-error-message",
                ErrorData: "my-error-data",
                ErrorType: "my-error-type",
                StackTrace: ["my-error-stack-trace"],
              },
              Action: OperationAction.FAIL,
            },
            events: [],
          },
        ] satisfies CheckpointOperation[];

        (checkpointApi.pollCheckpointData as jest.Mock)
          .mockResolvedValueOnce({
            operations: mockOperations,
            operationInvocationIdMap: {
              op1: [createInvocationId("test-invocation")],
            },
          })
          .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

        const result = await orchestrator.executeHandler({
          payload: { input: "test" },
        });

        expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
          JSON.stringify({
            input: "test",
          })
        );
        mockInvoke.mockResolvedValue({
          Status: InvocationStatus.FAILED,
        });
        expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
          durableExecutionArn: mockExecutionId,
          checkpointToken: mockCheckpointToken,
          operations: [mockOperation],
        });
        expect(result).toEqual({
          status: OperationStatus.FAILED,
          error: {
            ErrorMessage: "my-error-message",
            ErrorData: "my-error-data",
            ErrorType: "my-error-type",
            StackTrace: ["my-error-stack-trace"],
          },
        });
      });

      it("should resolve execution with result when the execution update occurs even if invocation does not resolve", async () => {
        const mockOperations = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.SUCCEEDED,
            },
            update: {
              Id: "op1",
              Type: OperationType.EXECUTION,
              Name: "operation1",
              Payload: "execution-result",
              Action: OperationAction.SUCCEED,
            },
            events: [],
          },
        ] satisfies CheckpointOperation[];

        (checkpointApi.pollCheckpointData as jest.Mock)
          .mockResolvedValueOnce({
            operations: mockOperations,
            operationInvocationIdMap: {
              op1: [createInvocationId("test-invocation")],
            },
          })
          .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

        mockInvoke.mockImplementation(
          () =>
            new Promise(() => {
              /** never resolves */
            })
        );

        const result = await orchestrator.executeHandler({
          payload: { input: "test" },
        });

        expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
          JSON.stringify({
            input: "test",
          })
        );
        expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
          durableExecutionArn: mockExecutionId,
          checkpointToken: mockCheckpointToken,
          operations: [mockOperation],
        });
        expect(result).toEqual({
          status: OperationStatus.SUCCEEDED,
          result: "execution-result",
        });
      });

      it("should not wait for execution checkpoint when the execution update occurs if the invocation success does not include any result", async () => {
        const mockOperations = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.SUCCEEDED,
            },
            update: {
              Id: "op1",
              Type: OperationType.EXECUTION,
              Name: "operation1",
              Payload: "execution-result", // this will get ignored, since invocation completed without any result
              Action: OperationAction.SUCCEED,
            },
            events: [],
          },
        ] satisfies CheckpointOperation[];

        let resolvePolling: (() => void) | undefined;
        (checkpointApi.pollCheckpointData as jest.Mock)
          .mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => {
              resolvePolling = resolve;
            });
            return {
              operations: mockOperations,
              operationInvocationIdMap: {
                op1: [createInvocationId("test-invocation")],
              },
            };
          })
          .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

        mockInvoke.mockResolvedValue({
          Status: InvocationStatus.SUCCEEDED,
        });

        const result = orchestrator.executeHandler({
          payload: { input: "test" },
        });

        // Wait for invocation to resolve
        await new Promise((resolve) => setImmediate(resolve));

        expect(mockInvoke).toHaveBeenCalledTimes(1);

        expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
          JSON.stringify({
            input: "test",
          })
        );
        expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
          durableExecutionArn: mockExecutionId,
          checkpointToken: mockCheckpointToken,
          operations: [mockOperation],
        });

        resolvePolling!();

        expect(await result).toEqual({
          status: OperationStatus.SUCCEEDED,
        });
      });

      it("should reject execution with result when the execution update occurs without a status", async () => {
        const mockOperations = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Type: OperationType.EXECUTION,
              ExecutionDetails: {
                InputPayload: "execution-result",
              },
            },
            update: {
              Id: "op1",
              Type: OperationType.EXECUTION,
              Name: "operation1",
              Payload: "execution-result",
            },
            events: [],
          },
        ] satisfies CheckpointOperation[];

        (checkpointApi.pollCheckpointData as jest.Mock)
          .mockResolvedValueOnce({
            operations: mockOperations,
            operationInvocationIdMap: {
              op1: [createInvocationId("test-invocation")],
            },
          })
          .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

        await expect(() =>
          orchestrator.executeHandler({
            payload: { input: "test" },
          })
        ).rejects.toThrow("Could not find status in execution operation");

        expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
          JSON.stringify({
            input: "test",
          })
        );
        expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
          durableExecutionArn: mockExecutionId,
          checkpointToken: mockCheckpointToken,
          operations: [mockOperation],
        });
      });
    });

    it("should handle execution without parameters", async () => {
      const result = await orchestrator.executeHandler();

      expect(checkpointApi.startDurableExecution).toHaveBeenCalledWith(
        undefined
      );
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
    });

    it("should start polling for checkpoint data", async () => {
      await orchestrator.executeHandler();

      expect(checkpointApi.pollCheckpointData).toHaveBeenCalledWith(
        mockExecutionId,
        expect.any(Object) // AbortController signal
      );
    });

    it("should process operations when received from polling", async () => {
      const mockOperations = [
        {
          operation: mockOperation,
          update: {
            Id: "op1",
            Type: OperationType.STEP,
          },
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            op1: [createInvocationId("test-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await orchestrator.executeHandler();

      expect(mockOperationStorage.populateOperations).toHaveBeenCalledWith(
        mockOperations
      );
    });

    it("should process STEP operations without client-side checkpoint updates", async () => {
      const stepOperation: Operation = {
        Id: "step-op",
        Name: "process-step",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      };

      const mockOperations = [
        {
          operation: stepOperation,
          update: {
            Id: "step-op",
            Type: OperationType.STEP,
            Action: "SUCCEED",
            Result: JSON.stringify({ result: "processed" }),
          },
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "step-op": [createInvocationId("test-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await orchestrator.executeHandler();

      expect(mockOperationStorage.populateOperations).toHaveBeenCalledWith(
        mockOperations
      );
      // STEP operations should NOT trigger updateCheckpointData calls
      expect(checkpointApi.updateCheckpointData).not.toHaveBeenCalled();
      // STEP operations should NOT trigger re-invocation
      expect(checkpointApi.startInvocation).not.toHaveBeenCalled();
    });

    it("should handle handler invocation errors", async () => {
      const mockError = new Error("Handler invocation failed");
      mockInvoke.mockRejectedValue(mockError);

      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Handler invocation failed"
      );
    });

    it("should handle non-SUCCEEDED/FAILED status responses", async () => {
      // Mock a never-resolving polling to simulate PENDING status
      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        () =>
          new Promise(() => {
            // Never resolves - simulates hanging polling
          })
      );

      const pendingResult = {
        Status: InvocationStatus.PENDING,
      } satisfies DurableExecutionInvocationOutput;

      mockInvoke.mockResolvedValue(pendingResult);

      const executePromise = orchestrator.executeHandler();

      // Give some time for the handler to be invoked
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      expect(mockInvoke).toHaveBeenCalledWith(mockHandlerFunction, {
        durableExecutionArn: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [mockOperation],
      });

      // The promise should not resolve immediately for PENDING status
      const timeoutSymbol = Symbol("timeout");
      const raceResult = await Promise.race([
        executePromise,
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(timeoutSymbol);
          }, 50);
        }),
      ]);

      expect(raceResult).toBe(timeoutSymbol);
    });

    it("should handle AbortError gracefully during polling", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";

      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw abortError;
        }
      );

      // Should not throw - AbortError should be handled gracefully
      const result = await orchestrator.executeHandler();

      expect(result.status).toBe(OperationStatus.SUCCEEDED);
    });

    it("should propagate non-AbortError polling errors", async () => {
      const pollingError = new Error("Polling failed");
      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw pollingError;
        }
      );

      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Polling failed"
      );
    });

    it("should abort polling when execution completes", async () => {
      let abortSignal: AbortSignal | undefined;

      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async (executionId: string, signal: AbortSignal) => {
          abortSignal = signal;
          return { operations: [], operationInvocationIdMap: {} };
        }
      );

      await orchestrator.executeHandler();

      expect(abortSignal?.aborted).toBe(true);
    });

    it("should abort polling even when execution promise throws an error", async () => {
      let abortSignal: AbortSignal | undefined;

      // Mock polling to capture the abort signal
      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async (executionId: string, signal: AbortSignal) => {
          abortSignal = signal;
          return { operations: [], operationInvocationIdMap: {} };
        }
      );

      // Mock the execution state to throw an error
      const mockError = new Error("Execution state error");
      mockInvoke.mockRejectedValue(mockError);

      // Execution should throw the error
      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Execution state error"
      );

      // But abort should still be called due to the finally block
      expect(abortSignal?.aborted).toBe(true);
    });
  });

  describe("error handling in polling", () => {
    it("should handle errors with missing name property", async () => {
      // Create an Error and then delete the name property to simulate the edge case
      const errorWithoutName = new Error("Error without name");
      Object.defineProperty(errorWithoutName, "name", {
        value: undefined,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw errorWithoutName;
        }
      );

      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Error without name"
      );
    });

    it("should handle errors with non-string name property", async () => {
      // Create an error with a non-string name property
      const errorWithNumberName = new Error("Error with number name");
      Object.defineProperty(errorWithNumberName, "name", {
        value: 123,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw errorWithNumberName;
        }
      );

      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Error with number name"
      );
    });
  });

  describe("constructor", () => {
    it("should initialize with skipTime parameter", () => {
      const skipTimeOrchestrator = new TestExecutionOrchestrator(
        mockHandlerFunction,
        mockOperationStorage,
        checkpointApi,
        mockScheduler,
        mockFunctionStorage,
        true
      );

      expect(skipTimeOrchestrator).toBeInstanceOf(TestExecutionOrchestrator);
    });

    it("should initialize without skipTime parameter", () => {
      const defaultOrchestrator = new TestExecutionOrchestrator(
        mockHandlerFunction,
        mockOperationStorage,
        checkpointApi,
        mockScheduler,
        mockFunctionStorage,
        true
      );

      expect(defaultOrchestrator).toBeInstanceOf(TestExecutionOrchestrator);
    });
  });

  describe("invocation tracking", () => {
    it("should create invocation record for each handler invocation", async () => {
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockImplementation(() => {
          terminateExecution();
          return {
            Status: InvocationStatus.SUCCEEDED,
          };
        });

      const firstInvocationId = createInvocationId("first-invocation");
      const secondInvocationId = createInvocationId("second-invocation");

      // First set up the initial invocation
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [mockOperation],
        invocationId: firstInvocationId,
      });

      // Set up a second invocation when a wait operation is completed
      jest.spyOn(checkpointApi, "startInvocation").mockResolvedValue({
        checkpointToken: createCheckpointToken("second-token"),
        executionId: mockExecutionId,
        operations: [],
        invocationId: secondInvocationId,
      });

      // Set up wait operation to trigger second invocation
      const waitOperation = {
        operation: {
          Id: "wait-op",
          Name: "test-wait",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "wait-op",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 0.25 }, // use real timers so keep wait time short
        },
      };

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: [waitOperation],
          operationInvocationIdMap: { "wait-op": [firstInvocationId] },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await orchestrator.executeHandler();

      // Get invocations
      const invocations = orchestrator.getInvocations();

      // Should have two invocations
      expect(invocations).toHaveLength(2);

      // Verify invocation IDs
      expect(invocations[0]?.id).toBe(firstInvocationId);
      expect(invocations[1]?.id).toBe(secondInvocationId);

      // Verify each invocation has the getOperations function
      expect(typeof invocations[0]?.getOperations).toBe("function");
      expect(typeof invocations[1]?.getOperations).toBe("function");
    });

    it("should reset invocations when starting a new execution", async () => {
      // Set up first execution with one invocation ID
      const firstInvocationId = createInvocationId("first-execution");

      // First set up the initial invocation
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [mockOperation],
        invocationId: firstInvocationId,
      });

      // Run first execution
      await orchestrator.executeHandler();

      // Get invocations after first execution
      const firstExecutionInvocations = orchestrator.getInvocations();
      expect(firstExecutionInvocations.length).toBe(1);
      expect(firstExecutionInvocations[0]?.id).toBe(firstInvocationId);

      // Set up second execution with different invocation ID
      const secondInvocationId = createInvocationId("second-execution");

      // Change mock to return different invocation ID for second execution
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [mockOperation],
        invocationId: secondInvocationId,
      });

      // Run second execution
      await orchestrator.executeHandler();

      // Get invocations after second execution
      const secondExecutionInvocations = orchestrator.getInvocations();

      // Verify only the second execution's invocation is present
      expect(secondExecutionInvocations).toHaveLength(1);
      expect(secondExecutionInvocations[0]?.id).toBe(secondInvocationId);
    });

    it("should associate operations with invocations", async () => {
      const invocationId = createInvocationId("test-invocation");
      const operationId = "test-op-id";

      // Setup mock operations
      const mockOp = {
        operation: {
          Id: operationId,
          Name: "test-op",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: operationId,
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        },
      };

      // Mock invocation and polling
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [],
        invocationId: invocationId,
      });

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: [mockOp],
          operationInvocationIdMap: { [operationId]: [invocationId] },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      // Execute to observe the integration between operations and invocations
      await orchestrator.executeHandler();

      // Get invocations and check that operations are associated
      const invocations = orchestrator.getInvocations();
      expect(invocations.length).toBe(1);

      const mockOperationResult = new OperationWithData(
        new OperationWaitManager(),
        new IndexedOperations([]),
        {} as DurableApiClient
      );

      jest.spyOn(mockOperationResult, "getId").mockReturnValue(operationId);
      jest.spyOn(mockOperationResult, "getStatus").mockReturnValue("SUCCEEDED");

      jest
        .spyOn(mockOperationStorage, "getOperations")
        .mockReturnValue([mockOperationResult]);

      // Now get operations for the invocation
      const ops = invocations[0]?.getOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0]?.getId()).toBe(operationId);
    });

    it("should throw error when invocation ID mapping is missing for an operation", async () => {
      // Setup an operation with no invocation mapping
      const mockOp = {
        operation: {
          Id: "orphan-op",
          Name: "orphan-operation",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "orphan-op",
          Type: OperationType.STEP,
          Action: OperationAction.SUCCEED,
        },
      };

      // Return operation but with empty invocation mapping
      (checkpointApi.pollCheckpointData as jest.Mock).mockResolvedValueOnce({
        operations: [mockOp],
        operationInvocationIdMap: {}, // Missing mapping for "orphan-op"
      });

      // Should throw an error about missing invocations
      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Could not find invocations for operation orphan-op"
      );
    });
  });

  describe("handleStepUpdate with retry", () => {
    it("should schedule retry with correct delay and re-invoke handler", async () => {
      jest.useFakeTimers();

      const retryOperation: Operation = {
        Id: "retry-op",
        Name: "retry-step",
        Type: OperationType.STEP,
        Status: OperationStatus.PENDING,
      };

      const retryUpdate = {
        Id: "retry-op",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: {
          NextAttemptDelaySeconds: 5,
        },
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      // Mock new invocation data for retry
      (checkpointApi.startInvocation as jest.Mock).mockResolvedValue({
        checkpointToken: "retry-token",
        operations: [retryOperation],
      });

      // Start execution and let it process the retry
      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "retry-op": [createInvocationId("retry-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler();

      terminateExecution();

      await jest.advanceTimersByTimeAsync(6000); // Advance by retry delay

      await executePromise;

      // Verify new invocation was started
      expect(checkpointApi.startInvocation).toHaveBeenCalledWith(
        mockExecutionId
      );

      // Verify handler was re-invoked after retry
      expect(mockInvoke).toHaveBeenCalledTimes(2); // Initial + retry
      expect(mockInvoke).toHaveBeenLastCalledWith(mockHandlerFunction, {
        durableExecutionArn: mockExecutionId,
        checkpointToken: "retry-token",
        operations: [retryOperation],
      });
    });

    it("should use skipTime delay (1ms) when skipTime is true", async () => {
      jest.useFakeTimers();

      // Create orchestrator with skipTime enabled
      const orchestrator = new TestExecutionOrchestrator(
        mockHandlerFunction,
        mockOperationStorage,
        checkpointApi,
        mockScheduler,
        mockFunctionStorage,
        true // skipTime = true
      );

      const retryOperation: Operation = {
        Id: "skip-time-retry",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      };

      const retryUpdate = {
        Id: "skip-time-retry",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: {
          NextAttemptDelaySeconds: 10, // Should be ignored due to skipTime
        },
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "skip-time-retry": [createInvocationId("skip-time-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      (checkpointApi.startInvocation as jest.Mock).mockResolvedValue({
        checkpointToken: "skip-time-token",
        operations: [retryOperation],
      });

      const executePromise = orchestrator.executeHandler();

      await jest.advanceTimersByTimeAsync(1000);

      const result = await executePromise;

      // Verify execution completed successfully
      expect(result.status).toBe(OperationStatus.SUCCEEDED);

      // Verify new invocation was started (retry was triggered)
      expect(checkpointApi.startInvocation).toHaveBeenCalledWith(
        mockExecutionId
      );

      // Verify handler was re-invoked after retry
      expect(mockInvoke).toHaveBeenCalledTimes(2); // Initial + retry
    });

    it("should throw error when NextAttemptDelaySeconds is missing", async () => {
      const retryOperation: Operation = {
        Id: "missing-delay-retry",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      };

      const retryUpdate = {
        Id: "missing-delay-retry",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        // Missing StepOptions.NextAttemptDelaySeconds
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "missing-delay-retry": [
              createInvocationId("missing-delay-invocation"),
            ],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Step operation with retry is missing NextAttemptDelaySeconds"
      );
    });

    it("should throw error when operation ID is missing", async () => {
      const retryOperation: Operation = {
        // Missing Id
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      };

      const retryUpdate = {
        Id: "retry-no-op-id",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: {
          NextAttemptDelaySeconds: 3,
        },
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {},
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await expect(orchestrator.executeHandler()).rejects.toThrow(
        "Could not process operation without an Id"
      );
    });

    it("should not schedule retry for non-RETRY step actions", async () => {
      const stepOperation: Operation = {
        Id: "success-step",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      };

      const successUpdate = {
        Id: "success-step",
        Type: OperationType.STEP,
        Action: OperationAction.SUCCEED,
        Result: "success result",
      };

      const mockOperations = [
        {
          operation: stepOperation,
          update: successUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "success-step": [createInvocationId("success-step-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await orchestrator.executeHandler();

      // Verify no retry scheduling occurred
      expect(checkpointApi.startInvocation).not.toHaveBeenCalled();
    });

    it("should handle multiple retry operations in sequence", async () => {
      jest.useFakeTimers();

      const retry1Operation: Operation = {
        Id: "retry-1",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      };

      const retry2Operation: Operation = {
        Id: "retry-2",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      };

      const retry1Update = {
        Id: "retry-1",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: { NextAttemptDelaySeconds: 2 },
      };

      const retry2Update = {
        Id: "retry-2",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: { NextAttemptDelaySeconds: 4 },
      };

      const mockOperations = [
        { operation: retry1Operation, update: retry1Update },
        { operation: retry2Operation, update: retry2Update },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "retry-1": [createInvocationId("retry-1-invocation")],
            "retry-2": [createInvocationId("retry-2-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      (checkpointApi.startInvocation as jest.Mock).mockResolvedValue({
        checkpointToken: "multi-retry-token",
        operations: [retry1Operation, retry2Operation],
      });

      const executePromise = orchestrator.executeHandler();

      await mockScheduler.waitForScheduledFunction();

      await jest.advanceTimersByTimeAsync(4000); // Advance by max retry delay to trigger both

      await executePromise;

      // Verify startInvocation was called for both retries
      expect(checkpointApi.startInvocation).toHaveBeenCalledTimes(2);

      // Verify handler was re-invoked multiple times (initial + 2 retries)
      expect(mockInvoke).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should call updateCheckpointData with status READY before retry invocation", async () => {
      jest.useFakeTimers();

      const retryOperation: Operation = {
        Id: "status-ready-retry",
        Name: "status-test-step",
        Type: OperationType.STEP,
        Status: OperationStatus.PENDING,
      };

      const retryUpdate = {
        Id: "status-ready-retry",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: {
          NextAttemptDelaySeconds: 3,
        },
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "status-ready-retry": [
              createInvocationId("status-ready-invocation"),
            ],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      (checkpointApi.startInvocation as jest.Mock).mockResolvedValue({
        checkpointToken: "status-ready-token",
        operations: [retryOperation],
        executionId: mockExecutionId,
        invocationId: createInvocationId("new-invocation"),
      });

      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler();

      terminateExecution();

      await jest.advanceTimersByTimeAsync(4000); // Advance by retry delay

      await executePromise;

      // Verify updateCheckpointData was called with status READY
      expect(checkpointApi.updateCheckpointData).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId: "status-ready-retry",
        operationData: {
          Status: OperationStatus.READY,
        },
      });

      // Verify new invocation was started after status update
      expect(checkpointApi.startInvocation).toHaveBeenCalledWith(
        mockExecutionId
      );

      // Verify handler was re-invoked after retry
      expect(mockInvoke).toHaveBeenCalledTimes(2); // Initial + retry
    });

    it("should call updateCheckpointData with correct new parameter structure", async () => {
      jest.useFakeTimers();

      const waitOperation: Operation = {
        Id: "param-test-wait",
        Name: "parameter-test-wait",
        Type: OperationType.WAIT,
        Status: OperationStatus.STARTED,
      };

      const waitUpdate = {
        Id: "param-test-wait",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        WaitOptions: { WaitSeconds: 2 },
      };

      const mockOperations = [
        {
          operation: waitOperation,
          update: waitUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "param-test-wait": [createInvocationId("param-test-invocation")],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      (checkpointApi.startInvocation as jest.Mock).mockResolvedValue({
        checkpointToken: "param-test-token",
        operations: [waitOperation],
        executionId: mockExecutionId,
        invocationId: createInvocationId("new-invocation"),
      });

      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler();

      terminateExecution();

      await jest.advanceTimersByTimeAsync(3000); // Advance by wait delay

      await executePromise;

      // Verify updateCheckpointData was called with action parameter structure
      expect(checkpointApi.updateCheckpointData).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId: "param-test-wait",
        operationData: {
          Status: OperationStatus.SUCCEEDED,
        },
      });

      // Verify new invocation was started
      expect(checkpointApi.startInvocation).toHaveBeenCalledWith(
        mockExecutionId
      );
    });

    it("should execute callback before invocation function in scheduleAsyncFunction", async () => {
      jest.useFakeTimers();

      const retryOperation: Operation = {
        Id: "callback-order-test",
        Type: OperationType.STEP,
        Status: OperationStatus.PENDING,
      };

      const retryUpdate = {
        Id: "callback-order-test",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: {
          NextAttemptDelaySeconds: 1,
        },
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      // Track call order
      const callOrder: string[] = [];

      // Mock updateCheckpointData to track when it's called
      (checkpointApi.updateCheckpointData as jest.Mock).mockImplementation(
        () => {
          callOrder.push("updateCheckpointData");
          return Promise.resolve();
        }
      );

      // Mock startInvocation to track when it's called
      (checkpointApi.startInvocation as jest.Mock).mockImplementation(() => {
        callOrder.push("startInvocation");
        return Promise.resolve({
          checkpointToken: "callback-order-token",
          operations: [retryOperation],
          executionId: mockExecutionId,
          invocationId: createInvocationId("callback-order-invocation"),
        });
      });

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "callback-order-test": [
              createInvocationId("callback-order-invocation"),
            ],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
      });

      const executePromise = orchestrator.executeHandler();

      terminateExecution();

      await jest.advanceTimersByTimeAsync(2000); // Advance by retry delay

      await executePromise;

      // Verify callback (updateCheckpointData) was called before invocation function (startInvocation)
      expect(callOrder).toEqual(["updateCheckpointData", "startInvocation"]);
    });

    it("should still execute callback even when invocation function is skipped due to active invocation", async () => {
      jest.useFakeTimers();

      const retryOperation: Operation = {
        Id: "callback-with-active-invocation",
        Type: OperationType.STEP,
        Status: OperationStatus.PENDING,
      };

      const retryUpdate = {
        Id: "callback-with-active-invocation",
        Type: OperationType.STEP,
        Action: OperationAction.RETRY,
        StepOptions: {
          NextAttemptDelaySeconds: 1,
        },
      };

      const mockOperations = [
        {
          operation: retryOperation,
          update: retryUpdate,
        },
      ];

      // Set up an active invocation by having mockInvoke return a promise that doesn't resolve
      mockInvoke.mockImplementation(() => {
        return new Promise<DurableExecutionInvocationOutput>(() => {
          /** wait forever */
        });
      });

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "callback-with-active-invocation": [
              createInvocationId("callback-active-invocation"),
            ],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      // Mock updateCheckpointData to track if it gets called
      (checkpointApi.updateCheckpointData as jest.Mock).mockImplementation(
        () => {
          return Promise.resolve();
        }
      );

      // Mock startInvocation to track if it gets called during active invocation
      (checkpointApi.startInvocation as jest.Mock).mockImplementation(() => {
        return Promise.resolve({
          checkpointToken: "callback-active-token",
          operations: [retryOperation],
          executionId: mockExecutionId,
          invocationId: createInvocationId("callback-active-new-invocation"),
        });
      });

      const executePromise = orchestrator.executeHandler();

      // Wait for scheduled function to be registered, then trigger it
      await mockScheduler.waitForScheduledFunction();
      jest.runAllTimers();

      // At this point:
      // - The callback (updateCheckpointData) should have been called
      // - startInvocation should NOT have been called due to active invocation
      expect(checkpointApi.updateCheckpointData).toHaveBeenCalledTimes(1);
      expect(checkpointApi.startInvocation).not.toHaveBeenCalled();

      // Verify the initial invocation is still active
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      terminateExecution();

      await jest.advanceTimersByTimeAsync(1000); // Run cleanup timers

      await executePromise;

      // Final verification:
      // - Callback was called despite active invocation
      // - startInvocation should NOT have been called due to active invocation
      expect(checkpointApi.updateCheckpointData).toHaveBeenCalledTimes(1);
      expect(checkpointApi.startInvocation).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only one invoke should have occurred
    });
  });

  describe("handleCallbackUpdate", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return early when operation status is STARTED", async () => {
      const callbackOperation: Operation = {
        Id: "callback-started",
        Name: "callback-operation",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.STARTED,
      };

      const callbackUpdate = {
        Id: "callback-started",
        Type: OperationType.CALLBACK,
        Action: OperationAction.START,
      };

      const mockOperations = [
        {
          operation: callbackOperation,
          update: callbackUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "callback-started": [
              createInvocationId("callback-started-invocation"),
            ],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      await orchestrator.executeHandler();

      // Verify no additional API calls were made for callback processing
      expect(checkpointApi.startInvocation).not.toHaveBeenCalled();
      // Only the initial invocation should have occurred
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("should return early when there is an active invocation", async () => {
      const callbackOperation: Operation = {
        Id: "callback-active-inv",
        Name: "callback-operation",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.SUCCEEDED,
      };

      const callbackUpdate = {
        Id: "callback-active-inv",
        Type: OperationType.CALLBACK,
        Action: OperationAction.SUCCEED,
      };

      // Set up a never-resolving invocation to simulate active invocation
      let resolveInvoke:
        | ((result: DurableExecutionInvocationOutput) => void)
        | undefined;
      mockInvoke.mockImplementation(() => {
        return new Promise<DurableExecutionInvocationOutput>((resolve) => {
          resolveInvoke = resolve;
        });
      });

      const mockOperations = [
        {
          operation: callbackOperation,
          update: callbackUpdate,
        },
      ];

      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: mockOperations,
          operationInvocationIdMap: {
            "callback-active-inv": [
              createInvocationId("callback-active-invocation"),
            ],
          },
        })
        .mockResolvedValue({ operations: [], operationInvocationIdMap: {} });

      const executePromise = orchestrator.executeHandler();

      // Wait for the operation to be processed
      await new Promise((resolve) => setImmediate(resolve));

      // Verify no additional API calls were made for callback processing
      expect(checkpointApi.startInvocation).not.toHaveBeenCalled();
      // Only the initial invocation should have occurred
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      // Clean up by resolving the initial invocation
      resolveInvoke!({
        Status: InvocationStatus.SUCCEEDED,
        Result: "test-result",
      });

      await executePromise;
    });

    it("should process callback successfully when operation status is not STARTED and no active invocation", async () => {
      const callbackOperation: Operation = {
        Id: "callback-success",
        Name: "callback-operation",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.SUCCEEDED,
      };

      const callbackUpdate = {
        Id: "callback-success",
        Type: OperationType.CALLBACK,
        Action: OperationAction.SUCCEED,
      };

      const mockOperations = [
        {
          operation: callbackOperation,
          update: callbackUpdate,
        },
      ];

      // Mock initial invocation to complete quickly
      mockInvoke
        .mockResolvedValueOnce({
          Status: InvocationStatus.PENDING,
        })
        .mockResolvedValueOnce({
          Status: InvocationStatus.SUCCEEDED,
          Result: "callback-result",
        });

      // Mock callback invocation data
      const callbackInvocationId = createInvocationId(
        "callback-new-invocation"
      );
      (checkpointApi.startInvocation as jest.Mock).mockResolvedValue({
        checkpointToken: createCheckpointToken("callback-token"),
        executionId: mockExecutionId,
        operations: [callbackOperation],
        invocationId: callbackInvocationId,
      });

      let resolvePolling: (() => void) | undefined;
      (checkpointApi.pollCheckpointData as jest.Mock).mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePolling = () => {
            resolve({
              operations: mockOperations,
              operationInvocationIdMap: {
                "callback-success": [
                  createInvocationId("callback-success-invocation"),
                ],
              },
            });
          };
        });
      });

      const executePromise = orchestrator.executeHandler();

      await new Promise((resolve) => setImmediate(resolve));

      resolvePolling!();

      const result = await executePromise;

      // Verify startInvocation was called
      expect(checkpointApi.startInvocation).toHaveBeenCalledWith(
        mockExecutionId
      );

      // Verify handler was invoked twice (initial + callback)
      expect(mockInvoke).toHaveBeenCalledTimes(2);

      // Verify second invocation had correct parameters
      expect(mockInvoke).toHaveBeenNthCalledWith(2, mockHandlerFunction, {
        durableExecutionArn: mockExecutionId,
        checkpointToken: createCheckpointToken("callback-token"),
        operations: [callbackOperation],
      });

      // Verify execution completed successfully
      expect(result.status).toBe(OperationStatus.SUCCEEDED);
    });
  });

  describe("scheduling", () => {
    it("should skip scheduled function execution when there is an active invocation", async () => {
      jest.useFakeTimers();

      // Set up an execution with a wait operation that will trigger scheduled function
      const invocationId = createInvocationId("active-invocation");
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [],
        invocationId: invocationId,
      });

      let resolveInvoke:
        | ((result: DurableExecutionInvocationOutput) => void)
        | undefined;
      mockInvoke.mockImplementation(() => {
        return new Promise<DurableExecutionInvocationOutput>((resolve) => {
          resolveInvoke = resolve;
        });
      });

      // Set up a wait operation to test the scheduled function behavior
      const waitOperation = {
        operation: {
          Id: "wait-op",
          Name: "test-wait",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "wait-op",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 1 },
        },
      };

      // Mock first polling to return wait operation, then empty
      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: [waitOperation],
          operationInvocationIdMap: {
            "wait-op": [invocationId],
          },
        })
        .mockResolvedValue({
          operations: [],
          operationInvocationIdMap: {},
        });

      // Mock updateCheckpointData and startInvocation
      jest
        .spyOn(checkpointApi, "updateCheckpointData")
        .mockResolvedValue(undefined);
      jest.spyOn(checkpointApi, "startInvocation").mockResolvedValue({
        checkpointToken: createCheckpointToken("new-token"),
        executionId: mockExecutionId,
        operations: [],
        invocationId: createInvocationId("new-invocation"),
      });

      const executePromise = orchestrator.executeHandler();

      await mockScheduler.waitForScheduledFunction();
      jest.runAllTimers();

      // Only one invoke should have happened before we resolve the invocation
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      resolveInvoke!({
        Result: "",
        Status: InvocationStatus.SUCCEEDED,
      });

      await jest.advanceTimersByTimeAsync(1000); // Run cleanup timers

      await executePromise;

      // Only one invocation should have occurred in the whole execution
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("should not skip scheduled function execution when there is an active invocation and skipTime is true", async () => {
      jest.useFakeTimers();

      const orchestrator = new TestExecutionOrchestrator(
        mockHandlerFunction,
        mockOperationStorage,
        checkpointApi,
        mockScheduler,
        mockFunctionStorage,
        true
      );

      // Set up an execution with a wait operation that will trigger scheduled function
      const invocationId = createInvocationId("active-invocation");
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [],
        invocationId: invocationId,
      });

      let resolveInvoke:
        | ((result: DurableExecutionInvocationOutput) => void)
        | undefined;
      mockInvoke
        .mockImplementationOnce(() => {
          return new Promise<DurableExecutionInvocationOutput>((resolve) => {
            resolveInvoke = resolve;
          });
        })
        .mockResolvedValue({
          Status: InvocationStatus.SUCCEEDED,
        });

      // Set up a wait operation to test the scheduled function behavior
      const waitOperation = {
        operation: {
          Id: "wait-op",
          Name: "test-wait",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "wait-op",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 1 },
        },
      };

      // Mock first polling to return wait operation, then empty
      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: [waitOperation],
          operationInvocationIdMap: {
            "wait-op": [invocationId],
          },
        })
        .mockResolvedValue({
          operations: [],
          operationInvocationIdMap: {},
        });

      // Mock updateCheckpointData and startInvocation
      jest
        .spyOn(checkpointApi, "updateCheckpointData")
        .mockResolvedValue(undefined);
      jest.spyOn(checkpointApi, "startInvocation").mockResolvedValue({
        checkpointToken: createCheckpointToken("new-token"),
        executionId: mockExecutionId,
        operations: [],
        invocationId: createInvocationId("new-invocation"),
      });

      const executePromise = orchestrator.executeHandler();

      await mockScheduler.waitForScheduledFunction();
      jest.runAllTimers();

      // First invoke
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      resolveInvoke!({
        Result: "",
        Status: InvocationStatus.SUCCEEDED,
      });

      await jest.advanceTimersByTimeAsync(1000); // Run cleanup timers

      await executePromise;

      // Two invokes since skipTime was true
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it("should fail execution if updateCheckpointData API throws an error", async () => {
      jest.useFakeTimers();

      // Set up a wait operation to test the scheduled function behavior
      const waitOperation = {
        operation: {
          Id: "wait-op",
          Name: "test-wait",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "wait-op",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 1 },
        },
      };

      // Set up an execution with a wait operation that will trigger scheduled function
      const invocationId = createInvocationId("active-invocation");
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [],
        invocationId: invocationId,
      });

      // Mock first polling to return wait operation, then empty
      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: [waitOperation],
          operationInvocationIdMap: { "wait-op": invocationId },
        })
        .mockResolvedValue({
          operations: [],
          operationInvocationIdMap: {},
        });

      jest
        .spyOn(checkpointApi, "updateCheckpointData")
        .mockRejectedValue(new Error("Failed to update checkpoint data"));

      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
        Result: "",
      });

      const executePromise = orchestrator.executeHandler();

      await mockScheduler.waitForScheduledFunction();

      // Queue up advancing timers
      void jest.advanceTimersByTimeAsync(5000);

      // Start execution
      await expect(executePromise).rejects.toThrow(
        "Failed to update checkpoint data"
      );

      // Only one invocation should have occurred in the whole execution
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it("should fail execution if startInvocation API throws an error", async () => {
      jest.useFakeTimers();

      // Set up a wait operation to test the scheduled function behavior
      const waitOperation = {
        operation: {
          Id: "wait-op",
          Name: "test-wait",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        },
        update: {
          Id: "wait-op",
          Type: OperationType.WAIT,
          Action: OperationAction.START,
          WaitOptions: { WaitSeconds: 1 },
        },
      };

      // Set up an execution with a wait operation that will trigger scheduled function
      const invocationId = createInvocationId("active-invocation");
      jest.spyOn(checkpointApi, "startDurableExecution").mockResolvedValue({
        executionId: mockExecutionId,
        checkpointToken: mockCheckpointToken,
        operations: [],
        invocationId: invocationId,
      });

      // Mock first polling to return wait operation, then empty
      (checkpointApi.pollCheckpointData as jest.Mock)
        .mockResolvedValueOnce({
          operations: [waitOperation],
          operationInvocationIdMap: { "wait-op": invocationId },
        })
        .mockResolvedValue({
          operations: [],
          operationInvocationIdMap: {},
        });

      jest
        .spyOn(checkpointApi, "startInvocation")
        .mockRejectedValue(new Error("Failed to start invocation"));

      mockInvoke.mockResolvedValue({
        Status: InvocationStatus.PENDING,
        Result: "",
      });

      const executePromise = orchestrator.executeHandler();

      await mockScheduler.waitForScheduledFunction();

      // Queue up advancing timers
      void jest.advanceTimersByTimeAsync(5000);

      // Start execution
      await expect(executePromise).rejects.toThrow(
        "Failed to start invocation"
      );

      // Only one invocation should have occurred in the whole execution
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
