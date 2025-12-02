import {
  Event,
  EventType,
  OperationType,
  OperationStatus,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import { historyEventsToOperationEvents } from "../process-history-events";

describe("historyEventsToOperationEvents", () => {
  const mockTimestamp = new Date("2023-01-01T00:00:00.000Z");
  const mockError: ErrorObject = {
    ErrorMessage: "Test error",
    ErrorType: "TestError",
    ErrorData: "test-data",
    StackTrace: ["line1", "line2"],
  };

  it("should throw error when EventType is missing", () => {
    const events: Event[] = [
      {
        Id: "test-id",
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
      },
    ];

    expect(() => {
      historyEventsToOperationEvents(events);
    }).toThrow("Missing required 'EventType' field in event");
  });

  it("should throw error when Id is missing", () => {
    const events: Event[] = [
      {
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
      },
    ];

    expect(() => {
      historyEventsToOperationEvents(events);
    }).toThrow("Missing required 'Id' field in event");
  });

  it("should not throw error when Id is missing for InvocationCompleted event", () => {
    const events: Event[] = [
      {
        EventType: EventType.InvocationCompleted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
      },
    ];

    expect(historyEventsToOperationEvents(events)).toEqual([]);
  });

  it("should handle EXECUTION operation types", () => {
    const events: Event[] = [
      {
        Id: "execution-id",
        EventType: EventType.ExecutionStarted,
        ExecutionStartedDetails: {
          Input: {
            Payload: '{"input": "data"}',
          },
          ExecutionTimeout: undefined,
        },
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
      },
      {
        Id: "execution-id",
        EventType: EventType.ExecutionSucceeded,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        ExecutionSucceededDetails: {
          Result: {
            Payload: "result",
          },
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].events).toHaveLength(2);
    expect(result[0].operation).toEqual({
      Id: "execution-id",
      Type: OperationType.EXECUTION,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:01:00Z"),
      ExecutionDetails: {
        InputPayload: '{"input": "data"}',
      },
    });
  });

  it("should process single STEP operation", () => {
    const events: Event[] = [
      {
        Id: "step-id",
        Name: "test-step",
        ParentId: "parent-id",
        SubType: "test-subtype",
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        StepStartedDetails: {
          Input: {
            Payload: '{"input": "data"}',
          },
        },
      },
      {
        Id: "step-id",
        EventType: EventType.StepSucceeded,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        StepSucceededDetails: {
          Result: {
            Payload: '{"result": "success"}',
          },
          RetryDetails: undefined,
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "step-id",
      Name: "test-step",
      ParentId: "parent-id",
      SubType: "test-subtype",
      Type: OperationType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:01:00Z"),
      StepDetails: {
        Result: '{"result": "success"}',
        Error: undefined,
      },
    });
    expect(result[0].events).toHaveLength(2);
  });

  it("should process CALLBACK operation with callback ID", () => {
    const events: Event[] = [
      {
        Id: "callback-id",
        Name: "test-callback",
        EventType: EventType.CallbackStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        CallbackStartedDetails: {
          CallbackId: "callback-123",
        },
      },
      {
        Id: "callback-id",
        EventType: EventType.CallbackSucceeded,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        CallbackSucceededDetails: {
          Result: {
            Payload: '{"callback": "result"}',
          },
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "callback-id",
      Name: "test-callback",
      Type: OperationType.CALLBACK,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:01:00Z"),
      CallbackDetails: {
        CallbackId: "callback-123",
        Result: '{"callback": "result"}',
        Error: undefined,
      },
    });
    expect(result[0].events).toHaveLength(2);
  });

  it("should process STEP operation with retry details", () => {
    const events: Event[] = [
      {
        Id: "step-id",
        Name: "test-step",
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        StepStartedDetails: {},
      },
      {
        Id: "step-id",
        EventType: EventType.StepFailed,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        StepFailedDetails: {
          Error: {
            Payload: {
              ErrorType: "TestError",
              ErrorMessage: "Test failed",
            },
          },
          RetryDetails: {
            CurrentAttempt: 2,
            NextAttemptDelaySeconds: 30,
          },
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "step-id",
      Name: "test-step",
      Type: OperationType.STEP,
      Status: OperationStatus.FAILED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:01:00Z"),
      StepDetails: {
        Result: undefined,
        Error: {
          ErrorType: "TestError",
          ErrorMessage: "Test failed",
        },
        Attempt: 2,
        NextAttemptTimestamp: new Date("2023-01-01T12:01:30Z"),
      },
    });
    expect(result[0].events).toHaveLength(2);
  });

  it("should process WAIT operation with scheduled timestamp", () => {
    const scheduledEndTimestamp = new Date("2023-01-01T13:00:00Z");
    const events: Event[] = [
      {
        Id: "wait-id",
        Name: "test-wait",
        EventType: EventType.WaitStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        WaitStartedDetails: {
          ScheduledEndTimestamp: scheduledEndTimestamp,
          Duration: undefined,
        },
      },
      {
        Id: "wait-id",
        EventType: EventType.WaitSucceeded,
        EventTimestamp: new Date("2023-01-01T13:00:00Z"),
        WaitSucceededDetails: {},
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "wait-id",
      Name: "test-wait",
      Type: OperationType.WAIT,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T13:00:00Z"),
      WaitDetails: {
        Result: undefined,
        Error: undefined,
        ScheduledEndTimestamp: scheduledEndTimestamp,
      },
    });
    expect(result[0].events).toHaveLength(2);
  });

  it("should process CHAINED_INVOKE operation", () => {
    const events: Event[] = [
      {
        Id: "invoke-id",
        Name: "test-invoke",
        EventType: EventType.ChainedInvokeStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        ChainedInvokeStartedDetails: {
          DurableExecutionArn: "my-durable-execution-arn",
          FunctionName: undefined,
        },
      },
      {
        Id: "invoke-id",
        EventType: EventType.ChainedInvokeSucceeded,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        ChainedInvokeSucceededDetails: {
          Result: {
            Payload: '{"invoke": "result"}',
          },
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "invoke-id",
      Name: "test-invoke",
      Type: OperationType.CHAINED_INVOKE,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:01:00Z"),
    });
    expect(result[0].events).toHaveLength(2);
  });

  it("should process CONTEXT operation", () => {
    const events: Event[] = [
      {
        Id: "context-id",
        Name: "test-context",
        EventType: EventType.ContextStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        ContextStartedDetails: {},
      },
      {
        Id: "context-id",
        EventType: EventType.ContextSucceeded,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        ContextSucceededDetails: {
          Result: {
            Payload: '{"context": "result"}',
          },
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "context-id",
      Name: "test-context",
      Type: OperationType.CONTEXT,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:01:00Z"),
      ContextDetails: {
        Result: '{"context": "result"}',
        Error: undefined,
      },
    });
    expect(result[0].events).toHaveLength(2);
  });

  it("should handle multiple different operations", () => {
    const events: Event[] = [
      {
        Id: "step-1",
        Name: "first-step",
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        StepStartedDetails: {},
      },
      {
        Id: "callback-1",
        Name: "first-callback",
        EventType: EventType.CallbackStarted,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        CallbackStartedDetails: {
          CallbackId: "callback-123",
        },
      },
      {
        Id: "step-1",
        EventType: EventType.StepSucceeded,
        EventTimestamp: new Date("2023-01-01T12:02:00Z"),
        StepSucceededDetails: {
          Result: {
            Payload: '{"step": "result"}',
          },
          RetryDetails: undefined,
        },
      },
      {
        Id: "callback-1",
        EventType: EventType.CallbackSucceeded,
        EventTimestamp: new Date("2023-01-01T12:03:00Z"),
        CallbackSucceededDetails: {
          Result: {
            Payload: '{"callback": "result"}',
          },
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(2);

    // Find step and callback operations
    const stepOperation = result.find(
      (op) => op.operation.Type === OperationType.STEP,
    );
    const callbackOperation = result.find(
      (op) => op.operation.Type === OperationType.CALLBACK,
    );

    expect(stepOperation).toBeDefined();
    expect(stepOperation!.operation.Id).toBe("step-1");
    expect(stepOperation!.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(stepOperation!.events).toHaveLength(2);

    expect(callbackOperation).toBeDefined();
    expect(callbackOperation!.operation.Id).toBe("callback-1");
    expect(callbackOperation!.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(callbackOperation!.events).toHaveLength(2);
  });

  it("should handle empty events array", () => {
    const events: Event[] = [];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("should handle mixed execution and non-execution events", () => {
    const events: Event[] = [
      {
        Id: "execution-id",
        EventType: EventType.ExecutionStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        ExecutionStartedDetails: {
          Input: undefined,
          ExecutionTimeout: undefined,
        },
      },
      {
        Id: "step-id",
        Name: "test-step",
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        StepStartedDetails: {},
      },
      {
        Id: "execution-id",
        EventType: EventType.ExecutionSucceeded,
        EventTimestamp: new Date("2023-01-01T12:02:00Z"),
        ExecutionSucceededDetails: {
          Result: undefined,
        },
      },
      {
        Id: "step-id",
        EventType: EventType.StepSucceeded,
        EventTimestamp: new Date("2023-01-01T12:03:00Z"),
        StepSucceededDetails: {
          Result: {
            Payload: '{"step": "result"}',
          },
          RetryDetails: undefined,
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(2);
    expect(result[0].operation.Type).toBe(OperationType.EXECUTION);
    expect(result[1].operation.Type).toBe(OperationType.STEP);
    expect(result[1].operation.Id).toBe("step-id");
    expect(result[1].events).toHaveLength(2);
  });

  it("should accumulate events for the same operation ID", () => {
    const events: Event[] = [
      {
        Id: "step-id",
        Name: "test-step",
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:00:00Z"),
        StepStartedDetails: {},
      },
      {
        Id: "step-id",
        EventType: EventType.StepFailed,
        EventTimestamp: new Date("2023-01-01T12:01:00Z"),
        StepFailedDetails: {
          RetryDetails: {
            CurrentAttempt: 1,
            NextAttemptDelaySeconds: 10,
          },
          Error: undefined,
        },
      },
      {
        Id: "step-id",
        EventType: EventType.StepStarted,
        EventTimestamp: new Date("2023-01-01T12:01:10Z"),
        StepStartedDetails: {},
      },
      {
        Id: "step-id",
        EventType: EventType.StepSucceeded,
        EventTimestamp: new Date("2023-01-01T12:02:00Z"),
        StepSucceededDetails: {
          Result: {
            Payload: '{"final": "result"}',
          },
          RetryDetails: undefined,
        },
      },
    ];

    const result = historyEventsToOperationEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(result[0].events).toHaveLength(4);
    expect(result[0].operation.StepDetails?.Result).toBe('{"final": "result"}');
  });

  it("should process CallbackStarted event with additional details", () => {
    const event: Event = {
      EventType: EventType.CallbackStarted,
      Id: "callback-1",
      Name: "test-callback",
      EventTimestamp: mockTimestamp,
      CallbackStartedDetails: {
        CallbackId: "callback-123",
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
      StartTimestamp: expect.any(Date),
      EndTimestamp: mockTimestamp,
      CallbackDetails: {
        Error: mockError,
      },
    });
  });

  it("should process WaitStarted event with Duration field", () => {
    const scheduledEndTimestamp = new Date("2023-01-01T00:05:00.000Z");
    const event: Event = {
      EventType: EventType.WaitStarted,
      Id: "wait-1",
      Name: "test-wait",
      EventTimestamp: mockTimestamp,
      WaitStartedDetails: {
        Duration: 300,
        ScheduledEndTimestamp: scheduledEndTimestamp,
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
        ScheduledEndTimestamp: scheduledEndTimestamp,
      },
    });
  });

  it("should process ChainedInvokeStarted event with additional ARN details", () => {
    const event: Event = {
      EventType: EventType.ChainedInvokeStarted,
      Id: "invoke-1",
      Name: "test-invoke",
      EventTimestamp: mockTimestamp,
      ChainedInvokeStartedDetails: {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
        FunctionName: undefined,
      },
    };

    const result = historyEventsToOperationEvents([event]);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toEqual({
      Id: "invoke-1",
      ParentId: undefined,
      Name: "test-invoke",
      Type: OperationType.CHAINED_INVOKE,
      SubType: undefined,
      Status: OperationStatus.STARTED,
      StartTimestamp: mockTimestamp,
    });
  });

  it("should merge events for the same operation ID with proper event accumulation", () => {
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
        RetryDetails: undefined,
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

  it("should handle multiple different operations with ParentId", () => {
    const executionEvent: Event = {
      EventType: EventType.ExecutionStarted,
      Id: "execution-1",
      Name: "test-execution",
      EventTimestamp: mockTimestamp,
      ExecutionStartedDetails: {
        Input: {
          Payload: '{"test": "data"}',
        },
        ExecutionTimeout: undefined,
      },
    };

    const stepEvent: Event = {
      EventType: EventType.StepStarted,
      Id: "step-1",
      Name: "test-step",
      EventTimestamp: mockTimestamp,
      StepStartedDetails: {},
    };

    const result = historyEventsToOperationEvents([executionEvent, stepEvent]);

    expect(result).toHaveLength(2);
    expect(result[0].operation.Id).toBe("execution-1");
    expect(result[1].operation.Id).toBe("step-1");
  });

  it("should handle events with undefined detail fields", () => {
    const event: Event = {
      EventType: EventType.StepSucceeded,
      Id: "step-1",
      Name: "test-step",
      EventTimestamp: mockTimestamp,
      StepSucceededDetails: undefined,
    };

    expect(() => historyEventsToOperationEvents([event])).toThrow(
      `Details missing for event "step-1"`,
    );
  });
});
