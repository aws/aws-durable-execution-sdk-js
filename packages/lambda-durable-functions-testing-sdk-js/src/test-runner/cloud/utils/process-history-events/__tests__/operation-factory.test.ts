import { Event, OperationType, OperationStatus, Operation } from "@aws-sdk/client-lambda";
import { OperationEvents } from "../../../../common/operations/operation-with-data";
import { createOperation, populateOperationDetails } from "../operation-factory";
import { HistoryEventType } from "../history-event-types";
import { historyEventTypes } from "../history-event-types";

describe("createOperation", () => {
  const mockEvent: Event = {
    Id: "test-id",
    Name: "test-operation",
    ParentId: "parent-id",
    SubType: "test-subtype",
    EventTimestamp: new Date("2023-01-01T12:00:00Z"),
  };

  const mockHistoryEventType: HistoryEventType = {
    operationType: OperationType.STEP,
    operationStatus: OperationStatus.STARTED,
    detailPlace: "StepStartedDetails",
    operationDetailPlace: "StepDetails",
    hasResult: false,
    isStartEvent: true,
    isEndEvent: false,
  };

  it("should create operation with basic properties from event", () => {
    const operation = createOperation(undefined, mockEvent, mockHistoryEventType);

    expect(operation).toEqual({
      Id: "test-id",
      Name: "test-operation",
      ParentId: "parent-id",
      Type: OperationType.STEP,
      SubType: "test-subtype",
      Status: OperationStatus.STARTED,
      StartTimestamp: new Date("2023-01-01T12:00:00Z"),
    });
  });

  it("should merge with previous operation events", () => {
    const previousOperationEvents: OperationEvents = {
      operation: {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date("2023-01-01T11:00:00Z"),
        StepDetails: {
          Attempt: 1,
        },
      },
      events: [],
    };

    const endEventType: HistoryEventType = {
      operationType: OperationType.STEP,
      operationStatus: OperationStatus.SUCCEEDED,
      detailPlace: "StepSucceededDetails",
      operationDetailPlace: "StepDetails",
      hasResult: true,
      isStartEvent: false,
      isEndEvent: true,
    };

    const operation = createOperation(previousOperationEvents, mockEvent, endEventType);

    expect(operation).toEqual({
      Id: "test-id",
      Name: "test-operation",
      ParentId: "parent-id",
      Type: OperationType.STEP,
      SubType: "test-subtype",
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2023-01-01T11:00:00Z"),
      EndTimestamp: new Date("2023-01-01T12:00:00Z"),
      StepDetails: {
        Attempt: 1,
      },
    });
  });

  it("should set StartTimestamp when isStartEvent is true", () => {
    const startEventType: HistoryEventType = {
      operationType: OperationType.CALLBACK,
      operationStatus: OperationStatus.STARTED,
      detailPlace: "CallbackStartedDetails",
      operationDetailPlace: "CallbackDetails",
      hasResult: false,
      isStartEvent: true,
      isEndEvent: false,
    };

    const operation = createOperation(undefined, mockEvent, startEventType);

    expect(operation.StartTimestamp).toEqual(new Date("2023-01-01T12:00:00Z"));
    expect(operation.EndTimestamp).toBeUndefined();
  });

  it("should set EndTimestamp when isEndEvent is true", () => {
    const endEventType: HistoryEventType = {
      operationType: OperationType.CALLBACK,
      operationStatus: OperationStatus.SUCCEEDED,
      detailPlace: "CallbackSucceededDetails",
      operationDetailPlace: "CallbackDetails",
      hasResult: true,
      isStartEvent: false,
      isEndEvent: true,
    };

    const operation = createOperation(undefined, mockEvent, endEventType);

    expect(operation.StartTimestamp).toBeUndefined();
    expect(operation.EndTimestamp).toEqual(new Date("2023-01-01T12:00:00Z"));
  });

  it("should set both timestamps when both isStartEvent and isEndEvent are true", () => {
    const bothEventType: HistoryEventType = {
      operationType: OperationType.WAIT,
      operationStatus: OperationStatus.STARTED,
      detailPlace: "WaitStartedDetails",
      operationDetailPlace: "WaitDetails",
      hasResult: true,
      isStartEvent: true,
      isEndEvent: true,
    };

    const operation = createOperation(undefined, mockEvent, bothEventType);

    expect(operation.StartTimestamp).toEqual(new Date("2023-01-01T12:00:00Z"));
    expect(operation.EndTimestamp).toEqual(new Date("2023-01-01T12:00:00Z"));
  });

  it("should preserve existing operation properties when merging", () => {
    const previousOperationEvents: OperationEvents = {
      operation: {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
        StartTimestamp: new Date("2023-01-01T11:00:00Z"),
        StepDetails: {
          Attempt: 1,
        },
      },
      events: [],
    };

    // Use a non-start event type to avoid overwriting StartTimestamp
    const nonStartEventType: HistoryEventType = {
      operationType: OperationType.STEP,
      operationStatus: OperationStatus.SUCCEEDED,
      detailPlace: "StepSucceededDetails",
      operationDetailPlace: "StepDetails",
      hasResult: true,
      isStartEvent: false,
      isEndEvent: true,
    };

    const operation = createOperation(previousOperationEvents, mockEvent, nonStartEventType);

    expect(operation.StepDetails).toEqual({ Attempt: 1 });
    expect(operation.StartTimestamp).toEqual(new Date("2023-01-01T11:00:00Z"));
  });

  it("should overwrite status from previous operation", () => {
    const previousOperationEvents: OperationEvents = {
      operation: {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.STEP,
        Status: OperationStatus.STARTED,
      },
      events: [],
    };

    const failedEventType: HistoryEventType = {
      operationType: OperationType.STEP,
      operationStatus: OperationStatus.FAILED,
      detailPlace: "StepFailedDetails",
      operationDetailPlace: "StepDetails",
      hasResult: true,
      isStartEvent: false,
      isEndEvent: true,
    };

    const operation = createOperation(previousOperationEvents, mockEvent, failedEventType);

    expect(operation.Status).toBe(OperationStatus.FAILED);
  });
});

describe("populateOperationDetails", () => {
  const baseEvent: Event = {
    Id: "test-id",
    EventTimestamp: new Date("2023-01-01T12:00:00Z"),
  };

  it("should throw error when EventTimestamp is missing", () => {
    const eventWithoutTimestamp: Event = {
      Id: "test-id",
    };

    const historyEventType = historyEventTypes.StepStarted;
    const operation: Operation = { Id: "test-id" };

    expect(() => {
      populateOperationDetails(eventWithoutTimestamp, historyEventType, operation);
    }).toThrow("Missing required fields in event");
  });

  it("should populate result and error when hasResult is true", () => {
    const event: Event = {
      ...baseEvent,
      StepSucceededDetails: {
        Result: {
          Payload: '{"success": true}',
        },
      },
    };

    const historyEventType = historyEventTypes.StepSucceeded;
    const operation: Operation = { Id: "test-id" };

    populateOperationDetails(event, historyEventType, operation);

    expect(operation.StepDetails).toEqual({
      Result: '{"success": true}',
      Error: undefined,
    });
  });

  it("should handle CALLBACK operation type", () => {
    const event: Event = {
      ...baseEvent,
      CallbackStartedDetails: {
        CallbackId: "callback-123",
      },
    };

    const historyEventType = historyEventTypes.CallbackStarted;
    const operation: Operation = { Id: "test-id" };

    populateOperationDetails(event, historyEventType, operation);

    expect(operation.CallbackDetails).toEqual({
      CallbackId: "callback-123",
    });
  });

  it("should handle STEP operation type with retry details", () => {
    const event: Event = {
      ...baseEvent,
      StepFailedDetails: {
        RetryDetails: {
          CurrentAttempt: 2,
          NextAttemptDelaySeconds: 30,
        },
      },
    };

    const historyEventType = historyEventTypes.StepFailed;
    const operation: Operation = { Id: "test-id" };

    populateOperationDetails(event, historyEventType, operation);

    expect(operation.StepDetails).toEqual({
      Result: undefined,
      Error: undefined,
      Attempt: 2,
      NextAttemptTimestamp: new Date("2023-01-01T12:00:30Z"),
    });
  });

  it("should handle STEP operation type without NextAttemptDelaySeconds", () => {
    const event: Event = {
      ...baseEvent,
      StepFailedDetails: {
        RetryDetails: {
          CurrentAttempt: 3,
        },
      },
    };

    const historyEventType = historyEventTypes.StepFailed;
    const operation: Operation = { Id: "test-id" };

    populateOperationDetails(event, historyEventType, operation);

    expect(operation.StepDetails).toEqual({
      Result: undefined,
      Error: undefined,
      Attempt: 3,
      NextAttemptTimestamp: undefined,
    });
  });

  it("should handle WAIT operation type", () => {
    const scheduledTimestamp = new Date("2023-01-01T13:00:00Z");
    const event: Event = {
      ...baseEvent,
      WaitStartedDetails: {
        ScheduledEndTimestamp: scheduledTimestamp,
      },
    };

    const historyEventType = historyEventTypes.WaitStarted;
    const operation: Operation = { Id: "test-id" };

    populateOperationDetails(event, historyEventType, operation);

    expect(operation.WaitDetails).toEqual({
      Result: undefined,
      Error: undefined,
      ScheduledTimestamp: scheduledTimestamp,
    });
  });

  it("should throw error for EXECUTION operation type", () => {
    const historyEventType = historyEventTypes.ExecutionStarted;
    const operation: Operation = { Id: "test-id" };

    expect(() => {
      populateOperationDetails(baseEvent, historyEventType, operation);
    }).toThrow("Cannot populate EXECUTION event");
  });

  it("should handle events with both result and error", () => {
    const event: Event = {
      ...baseEvent,
      StepFailedDetails: {
        Error: {
          Payload: {
            ErrorType: "TestError",
            ErrorMessage: "Test failed",
          },
        },
      },
    };

    const historyEventType = historyEventTypes.StepFailed;
    const operation: Operation = { Id: "test-id" };

    populateOperationDetails(event, historyEventType, operation);

    expect(operation.StepDetails).toEqual({
      Result: undefined,
      Error: {
        ErrorType: "TestError",
        ErrorMessage: "Test failed",
      },
      Attempt: undefined,
      NextAttemptTimestamp: undefined,
    });
  });
});
