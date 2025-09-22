import {
  OperationUpdate,
  OperationAction,
  OperationType,
  Operation,
  EventType,
} from "@aws-sdk/client-lambda";
import { EventProcessor } from "../event-processor";
import * as historyEventDetails from "../../utils/history-event-details";

// Mock the history-event-details module
jest.mock("../../utils/history-event-details");

describe("EventProcessor", () => {
  let eventProcessor: EventProcessor;
  const mockGetHistoryEventDetail = jest.mocked(
    historyEventDetails.getHistoryEventDetail
  );

  beforeEach(() => {
    eventProcessor = new EventProcessor();
    jest.clearAllMocks();
  });

  it("should create an instance without execution timeout", () => {
    const processor = new EventProcessor();
    expect(processor).toBeInstanceOf(EventProcessor);
  });

  describe("createHistoryEvent", () => {
    it("should create a history event with correct properties", () => {
      const eventType = EventType.ExecutionStarted;
      const operation: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.EXECUTION,
        SubType: "test-subtype",
        ParentId: "parent-id",
      };
      const detailPlace = "ExecutionStartedDetails" as const;
      const details = {
        Input: { Payload: "test-payload" },
        ExecutionTimeout: 3600,
      };

      const result = eventProcessor.createHistoryEvent(
        eventType,
        operation,
        detailPlace,
        details
      );

      expect(result).toEqual({
        EventType: eventType,
        SubType: operation.SubType,
        EventId: 1,
        Id: operation.Id,
        Name: operation.Name,
        EventTimestamp: expect.any(Date),
        ParentId: operation.ParentId,
        [detailPlace]: details,
      });
    });

    it("should increment event ID for subsequent events", () => {
      const eventType = EventType.ExecutionStarted;
      const operation: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.EXECUTION,
        SubType: "test-subtype",
      };
      const detailPlace = "ExecutionStartedDetails" as const;
      const details = {
        Input: { Payload: "test-payload" },
        ExecutionTimeout: 3600,
      };

      const firstEvent = eventProcessor.createHistoryEvent(
        eventType,
        operation,
        detailPlace,
        details
      );
      const secondEvent = eventProcessor.createHistoryEvent(
        eventType,
        operation,
        detailPlace,
        details
      );

      expect(firstEvent.EventId).toBe(1);
      expect(secondEvent.EventId).toBe(2);
    });

    it("should handle different detail types", () => {
      const eventType = EventType.ExecutionFailed;
      const operation: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.EXECUTION,
        SubType: "test-subtype",
      };
      const detailPlace = "ExecutionFailedDetails" as const;
      const details = {
        Error: {
          Payload: {
            ErrorType: "TestError",
            ErrorMessage: "Test error message",
          },
        },
      };

      const result = eventProcessor.createHistoryEvent(
        eventType,
        operation,
        detailPlace,
        details
      );

      expect(result.ExecutionFailedDetails).toEqual(details);
    });
  });

  describe("processUpdate", () => {
    const mockHistoryDetails = {
      eventType: EventType.ExecutionStarted,
      detailPlace: "ExecutionStartedDetails" as const,
      getDetails: jest.fn(),
    };

    beforeEach(() => {
      mockGetHistoryEventDetail.mockReturnValue(mockHistoryDetails);
      mockHistoryDetails.getDetails.mockReturnValue({
        Input: { Payload: "test-payload" },
        ExecutionTimeout: 3600,
      });
    });

    it("should process update and create history event", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
        ParentId: "parent-id",
        Payload: "test-payload",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.EXECUTION,
        SubType: "operation-subtype",
      };

      const result = eventProcessor.processUpdate(update, operation);

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.START,
        OperationType.EXECUTION
      );
      expect(mockHistoryDetails.getDetails).toHaveBeenCalledWith(
        update,
        operation,
        { executionTimeout: undefined }
      );
      expect(result).toEqual({
        EventType: EventType.ExecutionStarted,
        SubType: update.SubType,
        EventId: 1,
        Id: update.Id,
        Name: update.Name,
        EventTimestamp: expect.any(Date),
        ParentId: update.ParentId,
        ExecutionStartedDetails: {
          Input: { Payload: "test-payload" },
          ExecutionTimeout: 3600,
        },
      });
    });

    it("should pass execution timeout to getDetails", () => {
      const processorWithTimeout = new EventProcessor(7200);
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
        Payload: "test-payload",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.EXECUTION,
        SubType: "operation-subtype",
      };

      processorWithTimeout.processUpdate(update, operation);

      expect(mockHistoryDetails.getDetails).toHaveBeenCalledWith(
        update,
        operation,
        { executionTimeout: 7200 }
      );
    });

    it("should throw error when Action is missing", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        SubType: "update-subtype",
        Payload: "test-payload",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.EXECUTION,
        SubType: "operation-subtype",
      };

      expect(() => eventProcessor.processUpdate(update, operation)).toThrow(
        "Could not create history event with Action=undefined and Type=EXECUTION"
      );
    });

    it("should throw error when operation Type is missing", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
        Payload: "test-payload",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        SubType: "operation-subtype",
      };

      expect(() => eventProcessor.processUpdate(update, operation)).toThrow(
        "Could not create history event with Action=START and Type=undefined"
      );
    });

    it("should increment event ID for multiple updates", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
        Payload: "test-payload",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.EXECUTION,
        SubType: "operation-subtype",
      };

      const firstResult = eventProcessor.processUpdate(update, operation);
      const secondResult = eventProcessor.processUpdate(update, operation);

      expect(firstResult.EventId).toBe(1);
      expect(secondResult.EventId).toBe(2);
    });

    it("should handle different operation types", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
        Payload: "test-payload",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.STEP,
        SubType: "operation-subtype",
      };

      eventProcessor.processUpdate(update, operation);

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.START,
        OperationType.STEP
      );
    });

    it("should handle different action types", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.FAIL,
        SubType: "update-subtype",
        Error: { ErrorType: "TestError", ErrorMessage: "Test error" },
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.EXECUTION,
        SubType: "operation-subtype",
      };

      eventProcessor.processUpdate(update, operation);

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.FAIL,
        OperationType.EXECUTION
      );
    });
  });

  describe("getHistoryDetailsFromUpdate", () => {
    const mockHistoryDetails = {
      eventType: EventType.ExecutionStarted,
      detailPlace: "ExecutionStartedDetails" as const,
      getDetails: jest.fn(),
    };

    beforeEach(() => {
      mockGetHistoryEventDetail.mockReturnValue(mockHistoryDetails);
    });

    it("should return history details for valid action and type", () => {
      const result = EventProcessor.getHistoryDetailsFromUpdate(
        OperationAction.START,
        OperationType.EXECUTION
      );

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.START,
        OperationType.EXECUTION
      );
      expect(result).toBe(mockHistoryDetails);
    });

    it("should throw error when history details not found", () => {
      mockGetHistoryEventDetail.mockReturnValue(undefined);

      expect(() =>
        EventProcessor.getHistoryDetailsFromUpdate(
          OperationAction.START,
          OperationType.EXECUTION
        )
      ).toThrow(
        "Could not create history event with Action=START and Type=EXECUTION"
      );
    });

    it("should handle different combinations of action and type", () => {
      EventProcessor.getHistoryDetailsFromUpdate(
        OperationAction.SUCCEED,
        OperationType.STEP
      );

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.SUCCEED,
        OperationType.STEP
      );
    });

    it("should handle FAIL action with CONTEXT type", () => {
      EventProcessor.getHistoryDetailsFromUpdate(
        OperationAction.FAIL,
        OperationType.CONTEXT
      );

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.FAIL,
        OperationType.CONTEXT
      );
    });

    it("should handle RETRY action with STEP type", () => {
      EventProcessor.getHistoryDetailsFromUpdate(
        OperationAction.RETRY,
        OperationType.STEP
      );

      expect(mockGetHistoryEventDetail).toHaveBeenCalledWith(
        OperationAction.RETRY,
        OperationType.STEP
      );
    });
  });

  describe("event ID management", () => {
    it("should maintain separate event ID counters for different instances", () => {
      const processor1 = new EventProcessor();
      const processor2 = new EventProcessor();

      const operation: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.EXECUTION,
        SubType: "test-subtype",
      };

      const event1 = processor1.createHistoryEvent(
        EventType.ExecutionStarted,
        operation,
        "ExecutionStartedDetails",
        { Input: { Payload: "test" } }
      );

      const event2 = processor2.createHistoryEvent(
        EventType.ExecutionStarted,
        operation,
        "ExecutionStartedDetails",
        { Input: { Payload: "test" } }
      );

      expect(event1.EventId).toBe(1);
      expect(event2.EventId).toBe(1);
    });

    it("should continue incrementing event ID across different method calls", () => {
      const operation: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.EXECUTION,
        SubType: "test-subtype",
      };

      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
        Payload: "test-payload",
      };

      mockGetHistoryEventDetail.mockReturnValue({
        eventType: EventType.ExecutionStarted,
        detailPlace: "ExecutionStartedDetails" as const,
        getDetails: jest.fn().mockReturnValue({
          Input: { Payload: "test-payload" },
        }),
      });

      // Create event using createHistoryEvent
      const event1 = eventProcessor.createHistoryEvent(
        EventType.ExecutionStarted,
        operation,
        "ExecutionStartedDetails",
        { Input: { Payload: "test" } }
      );

      // Create event using processUpdate
      const event2 = eventProcessor.processUpdate(update, operation);

      // Create another event using createHistoryEvent
      const event3 = eventProcessor.createHistoryEvent(
        EventType.ExecutionSucceeded,
        operation,
        "ExecutionSucceededDetails",
        { Result: { Payload: "result" } }
      );

      expect(event1.EventId).toBe(1);
      expect(event2.EventId).toBe(2);
      expect(event3.EventId).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings in update and operation", () => {
      const update: OperationUpdate = {
        Id: "",
        Name: "",
        Action: OperationAction.START,
        SubType: "",
        Payload: "",
      };

      const operation: Operation = {
        Id: "",
        Name: "",
        Type: OperationType.EXECUTION,
        SubType: "",
      };

      mockGetHistoryEventDetail.mockReturnValue({
        eventType: EventType.ExecutionStarted,
        detailPlace: "ExecutionStartedDetails" as const,
        getDetails: jest.fn().mockReturnValue({
          Input: { Payload: "" },
        }),
      });

      const result = eventProcessor.processUpdate(update, operation);

      expect(result.Id).toBe("");
      expect(result.Name).toBe("");
      expect(result.SubType).toBe("");
    });

    it("should handle undefined optional fields", () => {
      const update: OperationUpdate = {
        Id: "update-id",
        Name: "update-name",
        Action: OperationAction.START,
        SubType: "update-subtype",
      };

      const operation: Operation = {
        Id: "operation-id",
        Name: "operation-name",
        Type: OperationType.EXECUTION,
        SubType: "operation-subtype",
      };

      mockGetHistoryEventDetail.mockReturnValue({
        eventType: EventType.ExecutionStarted,
        detailPlace: "ExecutionStartedDetails" as const,
        getDetails: jest.fn().mockReturnValue({
          Input: { Payload: undefined },
        }),
      });

      const result = eventProcessor.processUpdate(update, operation);

      expect(result.ParentId).toBeUndefined();
      expect(result.ExecutionStartedDetails?.Input?.Payload).toBeUndefined();
    });

    it("should handle undefined values in details", () => {
      const operation: Operation = {
        Id: "test-id",
        Name: "test-operation",
        Type: OperationType.EXECUTION,
        SubType: "test-subtype",
      };

      const details = {
        Input: { Payload: undefined },
        ExecutionTimeout: undefined,
      };

      const result = eventProcessor.createHistoryEvent(
        EventType.ExecutionStarted,
        operation,
        "ExecutionStartedDetails",
        details
      );

      expect(result.ExecutionStartedDetails).toEqual(details);
    });
  });
});
