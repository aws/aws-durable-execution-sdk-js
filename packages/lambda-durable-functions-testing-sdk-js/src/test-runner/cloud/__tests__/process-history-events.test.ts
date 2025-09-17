import {
  Event,
  EventType,
  OperationType,
  OperationStatus,
  ErrorObject,
} from "@amzn/dex-internal-sdk";
import { historyEventsToOperationEvents } from "../utils/process-history-events/process-history-events";

describe("historyEventsToOperationEvents", () => {
  const mockTimestamp = new Date("2023-01-01T00:00:00.000Z");
  const mockError: ErrorObject = {
    ErrorMessage: "Test error",
    ErrorType: "TestError",
    ErrorData: "test-data",
    StackTrace: ["line1", "line2"],
  };

  describe("basic functionality", () => {
    it("should handle empty events array", () => {
      const result = historyEventsToOperationEvents([]);
      expect(result).toEqual([]);
    });

    it("should throw error for events missing required fields", () => {
      const invalidEvent = {} as Event;
      expect(() => historyEventsToOperationEvents([invalidEvent])).toThrow(
        "Missing required fields in event"
      );
    });

    it("should throw error for events missing EventType", () => {
      const invalidEvent = {
        Id: "test-id",
        EventTimestamp: mockTimestamp,
      } as Event;
      expect(() => historyEventsToOperationEvents([invalidEvent])).toThrow(
        "Missing required fields in event"
      );
    });
  });

  it.each([
    EventType.ExecutionStarted,
    EventType.ExecutionFailed,
    EventType.ExecutionStopped,
    EventType.ExecutionSucceeded,
    EventType.ExecutionTimedOut,
  ])("should not process %s event", (eventType) => {
    const event: Event = {
      EventType: eventType,
      Id: "execution-1",
      Name: "test-execution",
      EventTimestamp: mockTimestamp,
      ExecutionFailedDetails: {
        Error: {
          Payload: mockError,
        },
      },
    };

    const result = historyEventsToOperationEvents([event]);

    expect(result).toHaveLength(0);
  });

  describe("CallbackStarted events", () => {
    it("should process CallbackStarted event correctly", () => {
      const event: Event = {
        EventType: EventType.CallbackStarted,
        Id: "callback-1",
        Name: "test-callback",
        EventTimestamp: mockTimestamp,
        CallbackStartedDetails: {
          CallbackId: "callback-123",
          Input: {
            Payload: '{"input": "data"}',
          },
          HeartbeatTimeout: 60,
          Timeout: 300,
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "callback-1",
        ParentId: undefined,
        Name: "test-callback",
        Type: OperationType.CALLBACK,
        SubType: undefined,
        Status: OperationStatus.STARTED,
        StartTimestamp: mockTimestamp,
        CallbackDetails: {
          CallbackId: "callback-123",
        },
      });
    });
  });

  describe("CallbackSucceeded events", () => {
    it("should process CallbackSucceeded event correctly", () => {
      const event: Event = {
        EventType: EventType.CallbackSucceeded,
        Id: "callback-1",
        Name: "test-callback",
        EventTimestamp: mockTimestamp,
        CallbackSucceededDetails: {
          Result: {
            Payload: '{"result": "callback-success"}',
          },
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "callback-1",
        ParentId: undefined,
        Name: "test-callback",
        Type: OperationType.CALLBACK,
        SubType: undefined,
        Status: OperationStatus.SUCCEEDED,
        EndTimestamp: mockTimestamp,
        CallbackDetails: {
          Result: '{"result": "callback-success"}',
        },
      });
    });
  });

  describe("CallbackFailed events", () => {
    it("should process CallbackFailed event correctly", () => {
      const event: Event = {
        EventType: EventType.CallbackFailed,
        Id: "callback-1",
        Name: "test-callback",
        EventTimestamp: mockTimestamp,
        CallbackFailedDetails: {
          Error: {
            Payload: mockError,
          },
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "callback-1",
        ParentId: undefined,
        Name: "test-callback",
        Type: OperationType.CALLBACK,
        SubType: undefined,
        Status: OperationStatus.FAILED,
        EndTimestamp: mockTimestamp,
        CallbackDetails: {
          Error: mockError,
        },
      });
    });
  });

  describe("ContextStarted events", () => {
    it("should process ContextStarted event correctly", () => {
      const event: Event = {
        EventType: EventType.ContextStarted,
        Id: "context-1",
        Name: "test-context",
        EventTimestamp: mockTimestamp,
        ContextStartedDetails: {},
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "context-1",
        ParentId: undefined,
        Name: "test-context",
        Type: OperationType.CONTEXT,
        SubType: undefined,
        Status: OperationStatus.STARTED,
        StartTimestamp: mockTimestamp,
      });
    });
  });

  describe("ContextSucceeded events", () => {
    it("should process ContextSucceeded event correctly", () => {
      const event: Event = {
        EventType: EventType.ContextSucceeded,
        Id: "context-1",
        Name: "test-context",
        EventTimestamp: mockTimestamp,
        ContextSucceededDetails: {
          Result: {
            Payload: '{"context": "result"}',
          },
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "context-1",
        ParentId: undefined,
        Name: "test-context",
        Type: OperationType.CONTEXT,
        SubType: undefined,
        Status: OperationStatus.SUCCEEDED,
        EndTimestamp: mockTimestamp,
        CallbackDetails: {
          Result: '{"context": "result"}',
        },
      });
    });
  });

  describe("StepStarted events", () => {
    it("should process StepStarted event correctly", () => {
      const event: Event = {
        EventType: EventType.StepStarted,
        Id: "step-1",
        Name: "test-step",
        EventTimestamp: mockTimestamp,
        StepStartedDetails: {},
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "step-1",
        ParentId: undefined,
        Name: "test-step",
        Type: OperationType.STEP,
        SubType: undefined,
        Status: OperationStatus.STARTED,
        StartTimestamp: mockTimestamp,
      });
    });
  });

  describe("StepFailed events", () => {
    it("should process StepFailed event with retry details correctly", () => {
      const event: Event = {
        EventType: EventType.StepFailed,
        Id: "step-1",
        Name: "test-step",
        EventTimestamp: mockTimestamp,
        StepFailedDetails: {
          Error: {
            Payload: mockError,
          },
          RetryDetails: {
            CurrentAttempt: 2,
            NextAttemptDelaySeconds: 30,
          },
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "step-1",
        ParentId: undefined,
        Name: "test-step",
        Type: OperationType.STEP,
        SubType: undefined,
        Status: OperationStatus.FAILED,
        EndTimestamp: mockTimestamp,
        StepDetails: {
          Attempt: 2,
          NextAttemptTimestamp: new Date("2023-01-01T00:00:30.000Z"),
          Error: mockError,
        },
      });
    });
  });

  describe("WaitStarted events", () => {
    it("should process WaitStarted event correctly", () => {
      const scheduledEndTime = new Date("2023-01-01T00:05:00.000Z");
      const event: Event = {
        EventType: EventType.WaitStarted,
        Id: "wait-1",
        Name: "test-wait",
        EventTimestamp: mockTimestamp,
        WaitStartedDetails: {
          Duration: 300,
          ScheduledEndTimestamp: scheduledEndTime,
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "wait-1",
        ParentId: undefined,
        Name: "test-wait",
        Type: OperationType.WAIT,
        SubType: undefined,
        Status: OperationStatus.STARTED,
        StartTimestamp: mockTimestamp,
        WaitDetails: {
          ScheduledTimestamp: scheduledEndTime,
        },
      });
    });
  });

  describe("InvokeStarted events", () => {
    it("should process InvokeStarted event correctly", () => {
      const event: Event = {
        EventType: EventType.InvokeStarted,
        Id: "invoke-1",
        Name: "test-invoke",
        EventTimestamp: mockTimestamp,
        InvokeStartedDetails: {
          Input: {
            Payload: '{"invoke": "input"}',
          },
          FunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
        },
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "invoke-1",
        ParentId: undefined,
        Name: "test-invoke",
        Type: OperationType.INVOKE,
        SubType: undefined,
        Status: OperationStatus.STARTED,
        StartTimestamp: mockTimestamp,
      });
    });
  });

  describe("multiple events for same operation", () => {
    it("should merge events for the same operation ID", () => {
      const startEvent: Event = {
        EventType: EventType.StepStarted,
        Id: "step-1",
        Name: "test-step",
        EventTimestamp: mockTimestamp,
        StepStartedDetails: {},
      };

      const endEvent: Event = {
        EventType: EventType.StepSucceeded,
        Id: "step-1",
        Name: "test-step",
        EventTimestamp: new Date("2023-01-01T00:01:00.000Z"),
        StepSucceededDetails: {
          Result: {
            Payload: '{"step": "result"}',
          },
        },
      };

      const result = historyEventsToOperationEvents([startEvent, endEvent]);

      expect(result).toHaveLength(1);
      expect(result[0].operation).toEqual({
        Id: "step-1",
        ParentId: undefined,
        Name: "test-step",
        Type: OperationType.STEP,
        SubType: undefined,
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: mockTimestamp,
        EndTimestamp: new Date("2023-01-01T00:01:00.000Z"),
        StepDetails: {
          Result: '{"step": "result"}',
        },
      });
      expect(result[0].events).toEqual([startEvent, endEvent]);
    });
  });

  describe("multiple different operations", () => {
    it("should handle multiple different operations", () => {
      const executionEvent: Event = {
        EventType: EventType.ExecutionStarted,
        Id: "execution-1",
        Name: "test-execution",
        EventTimestamp: mockTimestamp,
        ExecutionStartedDetails: {
          Input: {
            Payload: '{"test": "data"}',
          },
        },
      };

      const stepEvent: Event = {
        EventType: EventType.StepStarted,
        Id: "step-1",
        Name: "test-step",
        EventTimestamp: mockTimestamp,
        ParentId: "execution-1",
        StepStartedDetails: {},
      };

      const result = historyEventsToOperationEvents([
        executionEvent,
        stepEvent,
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].operation.Id).toBe("step-1");
      expect(result[0].operation.ParentId).toBe("execution-1");
    });
  });

  describe("edge cases", () => {
    it("should handle events with no detail place", () => {
      const event: Event = {
        EventType: EventType.StepStarted,
        Id: "execution-1",
        Name: "test-execution",
        EventTimestamp: mockTimestamp,
        StepStartedDetails: {},
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation.Status).toBe(OperationStatus.STARTED);
    });

    it("should handle events with undefined detail fields", () => {
      const event: Event = {
        EventType: EventType.StepSucceeded,
        Id: "step-1",
        Name: "test-step",
        EventTimestamp: mockTimestamp,
        StepSucceededDetails: undefined,
      };

      const result = historyEventsToOperationEvents([event]);

      expect(result).toHaveLength(1);
      expect(result[0].operation.Status).toBe(OperationStatus.SUCCEEDED);
    });
  });
});
