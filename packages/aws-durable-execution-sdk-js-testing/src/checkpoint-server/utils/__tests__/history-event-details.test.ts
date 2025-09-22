import {
  OperationAction,
  OperationUpdate,
  EventType,
  OperationType,
  Operation,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import { getHistoryEventDetail } from "../history-event-details";

describe("history-event-details", () => {
  const mockMetadata = {
    executionTimeout: 300,
  };

  const createMockErrorObject = (): ErrorObject => ({
    ErrorMessage: "test-error",
    ErrorType: "TestError",
    ErrorData: "test-error-data",
    StackTrace: ["Error: test-error", "at test (test.js:1:1)"],
  });

  const createMockUpdate = (
    overrides: Partial<OperationUpdate> = {}
  ): OperationUpdate => ({
    Payload: "test-payload",
    Error: createMockErrorObject(),
    CallbackOptions: {
      TimeoutSeconds: 60,
      HeartbeatTimeoutSeconds: 30,
    },
    InvokeOptions: {
      FunctionName: "test-function",
      DurableExecutionName: "test-execution",
    },
    StepOptions: {
      NextAttemptDelaySeconds: 5,
    },
    WaitOptions: {
      WaitSeconds: 10,
    },
    ...overrides,
  });

  const createMockOperation = (
    overrides: Partial<Operation> = {}
  ): Operation => ({
    CallbackDetails: {
      CallbackId: "test-callback-id",
    },
    StepDetails: {
      Attempt: 2,
    },
    ...overrides,
  });

  describe("getHistoryEventDetail", () => {
    it("should return undefined for unknown action-type combinations", () => {
      const result = getHistoryEventDetail(
        "UNKNOWN" as OperationAction,
        "UNKNOWN" as OperationType
      );
      expect(result).toBeUndefined();
    });

    describe("EXECUTION operations", () => {
      it("should return correct details for START-EXECUTION", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.EXECUTION
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.ExecutionStarted);
        expect(detail!.detailPlace).toBe("ExecutionStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Input: {
            Payload: "test-payload",
          },
          ExecutionTimeout: 300,
        });
      });

      it("should return correct details for FAIL-EXECUTION", () => {
        const detail = getHistoryEventDetail(
          OperationAction.FAIL,
          OperationType.EXECUTION
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.ExecutionFailed);
        expect(detail!.detailPlace).toBe("ExecutionFailedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Error: {
            Payload: createMockErrorObject(),
          },
        });
      });

      it("should return correct details for SUCCEED-EXECUTION", () => {
        const detail = getHistoryEventDetail(
          OperationAction.SUCCEED,
          OperationType.EXECUTION
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.ExecutionSucceeded);
        expect(detail!.detailPlace).toBe("ExecutionSucceededDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Result: {
            Payload: "test-payload",
          },
        });
      });
    });

    describe("CALLBACK operations", () => {
      it("should return correct details for START-CALLBACK", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.CALLBACK
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.CallbackStarted);
        expect(detail!.detailPlace).toBe("CallbackStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          CallbackId: "test-callback-id",
          Timeout: 60,
          HeartbeatTimeout: 30,
          Input: {
            Payload: "test-payload",
          },
        });
      });

      it("should handle missing callback details", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.CALLBACK
        );
        const update = createMockUpdate();
        const operation = createMockOperation({ CallbackDetails: undefined });
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          CallbackId: undefined,
          Timeout: 60,
          HeartbeatTimeout: 30,
          Input: {
            Payload: "test-payload",
          },
        });
      });

      it("should handle missing callback options", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.CALLBACK
        );
        const update = createMockUpdate({ CallbackOptions: undefined });
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          CallbackId: "test-callback-id",
          Timeout: undefined,
          HeartbeatTimeout: undefined,
          Input: {
            Payload: "test-payload",
          },
        });
      });
    });

    describe("CONTEXT operations", () => {
      it("should return correct details for START-CONTEXT", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.CONTEXT
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.ContextStarted);
        expect(detail!.detailPlace).toBe("ContextStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({});
      });

      it("should return correct details for FAIL-CONTEXT", () => {
        const detail = getHistoryEventDetail(
          OperationAction.FAIL,
          OperationType.CONTEXT
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.ContextFailed);
        expect(detail!.detailPlace).toBe("ContextFailedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Error: {
            Payload: createMockErrorObject(),
          },
        });
      });

      it("should return correct details for SUCCEED-CONTEXT", () => {
        const detail = getHistoryEventDetail(
          OperationAction.SUCCEED,
          OperationType.CONTEXT
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.ContextSucceeded);
        expect(detail!.detailPlace).toBe("ContextSucceededDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Result: {
            Payload: "test-payload",
          },
        });
      });
    });

    describe("INVOKE operations", () => {
      it("should return correct details for START-INVOKE", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.INVOKE
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.InvokeStarted);
        expect(detail!.detailPlace).toBe("InvokeStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Input: {
            Payload: "test-payload",
          },
          FunctionArn: "test-function",
          DurableExecutionArn: "test-execution",
        });
      });

      it("should handle missing invoke options", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.INVOKE
        );
        const update = createMockUpdate({ InvokeOptions: undefined });
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Input: {
            Payload: "test-payload",
          },
          FunctionArn: undefined,
          DurableExecutionArn: undefined,
        });
      });
    });

    describe("STEP operations", () => {
      it("should return correct details for START-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.STEP
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.StepStarted);
        expect(detail!.detailPlace).toBe("StepStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({});
      });

      it("should return correct details for RETRY-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.RETRY,
          OperationType.STEP
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.StepStarted);
        expect(detail!.detailPlace).toBe("StepStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({});
      });

      it("should return correct details for FAIL-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.FAIL,
          OperationType.STEP
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.StepFailed);
        expect(detail!.detailPlace).toBe("StepFailedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Error: {
            Payload: createMockErrorObject(),
          },
          RetryDetails: {
            NextAttemptDelaySeconds: 5,
            CurrentAttempt: 2,
          },
        });
      });

      it("should handle missing step details in FAIL-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.FAIL,
          OperationType.STEP
        );
        const update = createMockUpdate();
        const operation = createMockOperation({ StepDetails: undefined });
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Error: {
            Payload: createMockErrorObject(),
          },
          RetryDetails: {
            NextAttemptDelaySeconds: 5,
            CurrentAttempt: undefined,
          },
        });
      });

      it("should handle missing step options in FAIL-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.FAIL,
          OperationType.STEP
        );
        const update = createMockUpdate({ StepOptions: undefined });
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Error: {
            Payload: createMockErrorObject(),
          },
          RetryDetails: {
            NextAttemptDelaySeconds: undefined,
            CurrentAttempt: 2,
          },
        });
      });

      it("should return correct details for SUCCEED-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.SUCCEED,
          OperationType.STEP
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.StepSucceeded);
        expect(detail!.detailPlace).toBe("StepSucceededDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Result: {
            Payload: "test-payload",
          },
          RetryDetails: {
            NextAttemptDelaySeconds: 5,
            CurrentAttempt: 2,
          },
        });
      });

      it("should handle missing step details in SUCCEED-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.SUCCEED,
          OperationType.STEP
        );
        const update = createMockUpdate();
        const operation = createMockOperation({ StepDetails: undefined });
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Result: {
            Payload: "test-payload",
          },
          RetryDetails: {
            NextAttemptDelaySeconds: 5,
            CurrentAttempt: undefined,
          },
        });
      });

      it("should handle missing step options in SUCCEED-STEP", () => {
        const detail = getHistoryEventDetail(
          OperationAction.SUCCEED,
          OperationType.STEP
        );
        const update = createMockUpdate({ StepOptions: undefined });
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        expect(details).toEqual({
          Result: {
            Payload: "test-payload",
          },
          RetryDetails: {
            NextAttemptDelaySeconds: undefined,
            CurrentAttempt: 2,
          },
        });
      });
    });

    describe("WAIT operations", () => {
      beforeEach(() => {
        // Mock Date to ensure consistent test results
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("should return correct details for START-WAIT", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.WAIT
        );
        expect(detail).toBeDefined();
        expect(detail!.eventType).toBe(EventType.WaitStarted);
        expect(detail!.detailPlace).toBe("WaitStartedDetails");

        const update = createMockUpdate();
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        const expectedEndTime = new Date("2023-01-01T00:00:10.000Z"); // 10 seconds later

        expect(details).toEqual({
          Duration: 10,
          ScheduledEndTimestamp: expectedEndTime,
        });
      });

      it("should handle missing wait options", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.WAIT
        );
        const update = createMockUpdate({ WaitOptions: undefined });
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        const expectedEndTime = new Date("2023-01-01T00:00:00.000Z"); // No additional time

        expect(details).toEqual({
          Duration: undefined,
          ScheduledEndTimestamp: expectedEndTime,
        });
      });

      it("should handle zero wait seconds", () => {
        const detail = getHistoryEventDetail(
          OperationAction.START,
          OperationType.WAIT
        );
        const update = createMockUpdate({
          WaitOptions: {
            WaitSeconds: 0,
          },
        });
        const operation = createMockOperation();
        const details = detail!.getDetails(update, operation, mockMetadata);

        const expectedEndTime = new Date("2023-01-01T00:00:00.000Z"); // No additional time

        expect(details).toEqual({
          Duration: 0,
          ScheduledEndTimestamp: expectedEndTime,
        });
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty metadata", () => {
      const detail = getHistoryEventDetail(
        OperationAction.START,
        OperationType.EXECUTION
      );
      const update = createMockUpdate();
      const operation = createMockOperation();
      const details = detail!.getDetails(update, operation, {});

      expect(details).toEqual({
        Input: {
          Payload: "test-payload",
        },
        ExecutionTimeout: undefined,
      });
    });

    it("should handle empty update object", () => {
      const detail = getHistoryEventDetail(
        OperationAction.FAIL,
        OperationType.EXECUTION
      );
      const update = {} as OperationUpdate;
      const operation = createMockOperation();
      const details = detail!.getDetails(update, operation, mockMetadata);

      expect(details).toEqual({
        Error: {
          Payload: undefined,
        },
      });
    });

    it("should handle empty operation object", () => {
      const detail = getHistoryEventDetail(
        OperationAction.START,
        OperationType.CALLBACK
      );
      const update = createMockUpdate();
      const operation = {} as Operation;
      const details = detail!.getDetails(update, operation, mockMetadata);

      expect(details).toEqual({
        CallbackId: undefined,
        Timeout: 60,
        HeartbeatTimeout: 30,
        Input: {
          Payload: "test-payload",
        },
      });
    });
  });
});
