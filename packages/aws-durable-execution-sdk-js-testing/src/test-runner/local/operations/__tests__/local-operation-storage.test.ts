import {
  EventType,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { LocalOperationStorage } from "../local-operation-storage";
import { OperationWaitManager } from "../operation-wait-manager";
import { IndexedOperations } from "../../../common/indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "../../../common/operations/operation-with-data";
import { DurableApiClient } from "../../../common/create-durable-api-client";

// Mock the OperationWaitManager
jest.mock("../operation-wait-manager");

describe("LocalOperationStorage", () => {
  let mockWaitManager: OperationWaitManager;
  let mockIndexedOperations: IndexedOperations;
  let mockCallback: jest.Mock;
  let mockDurableApiClient: DurableApiClient;

  // Sample operations for testing
  const sampleOperations: OperationEvents[] = [
    {
      operation: {
        Id: "op1",
        Name: "operation1",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: undefined,
      },
      events: [
        {
          EventId: 1,
          EventType: EventType.StepStarted,
          EventTimestamp: new Date("2026-01-01"),
          StepStartedDetails: {},
          Name: "operation1",
          Id: "op1",
        },
        {
          EventId: 2,
          EventType: EventType.StepSucceeded,
          EventTimestamp: new Date("2026-01-01"),
          StepSucceededDetails: {
            Result: {
              Payload: "",
            },
            RetryDetails: undefined,
          },
          Name: "operation1",
          Id: "op1",
        },
      ],
    },
    {
      operation: {
        Id: "op2",
        Name: "operation2",
        Type: OperationType.WAIT,
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: undefined,
      },
      events: [
        {
          EventId: 3,
          EventType: EventType.WaitStarted,
          EventTimestamp: new Date("2026-01-01"),
          WaitStartedDetails: {
            Duration: 10,
            ScheduledEndTimestamp: undefined,
          },
          Name: "operation2",
          Id: "op2",
        },
        {
          EventId: 4,
          EventType: EventType.WaitSucceeded,
          EventTimestamp: new Date("2026-01-02"),
          WaitSucceededDetails: {},
          Name: "operation2",
          Id: "op2",
        },
      ],
    },
    {
      operation: {
        Id: "op3",
        Name: "operation1", // Same name as first operation
        Type: OperationType.CALLBACK,
        Status: OperationStatus.FAILED,
        StartTimestamp: undefined,
      },
      events: [
        {
          EventId: 5,
          EventType: EventType.CallbackStarted,
          EventTimestamp: new Date("2026-01-02"),
          StepSucceededDetails: {
            Result: undefined,
            RetryDetails: undefined,
          },
          Name: "operation1",
          Id: "op3",
        },
        {
          EventId: 6,
          EventType: EventType.CallbackSucceeded,
          EventTimestamp: new Date("2026-01-03"),
          StepSucceededDetails: {
            Result: undefined,
            RetryDetails: undefined,
          },
          Name: "operation1",
          Id: "op3",
        },
      ],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockIndexedOperations = new IndexedOperations([]);
    mockWaitManager = new OperationWaitManager(mockIndexedOperations);
    mockCallback = jest.fn();
    mockDurableApiClient = {
      sendCallbackSuccess: jest.fn(),
      sendCallbackFailure: jest.fn(),
      sendCallbackHeartbeat: jest.fn(),
    };
  });

  describe("populateOperations", () => {
    it("should update registered mock operations with matching ID", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      // Register the operation
      storage.registerOperation({
        operation: operation,
        params: {
          id: "op1",
        },
      });

      // Initially no data is populated
      expect(operation.getOperationData()).toBeUndefined();

      // Add operations
      storage.populateOperations(sampleOperations);

      // Now the operation should have data
      expect(operation.getOperationData()).toEqual({
        ...sampleOperations[0].operation,
      });
    });

    it("should update registered mock operations with matching name and index", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      // Register the operation
      storage.registerOperation({
        operation: operation,
        params: {
          name: "operation1",
          index: 1,
        },
      });

      // Initially no data is populated
      expect(operation.getOperationData()).toBeUndefined();

      // Add operations
      storage.populateOperations(sampleOperations);

      // Now the operation should have data (the second operation with name "operation1")
      expect(operation.getOperationData()).toEqual({
        ...sampleOperations[2].operation,
      });
    });

    it("should update registered mock operations with matching index only", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      // Register the operation
      storage.registerOperation({
        operation: operation,
        params: {
          index: 1,
        },
      });

      // Initially no data is populated
      expect(operation.getOperationData()).toBeUndefined();

      // Add operations
      storage.populateOperations(sampleOperations);

      // Now the operation should have data (index 1)
      expect(operation.getOperationData()).toEqual({
        ...sampleOperations[1].operation,
      });
    });

    it("should not throw for mock operations without matching operation data", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      // Register the operation
      storage.registerOperation({
        operation: operation,
        params: {
          name: "nonexistent",
        },
      });

      // Add operations
      expect(() => {
        storage.populateOperations(sampleOperations);
      }).not.toThrow();

      // The operation should still have no data
      expect(operation.getOperationData()).toBeUndefined();
    });

    it("should notify wait manager when operations are populated", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      // Register the operation
      storage.registerOperation({
        operation: operation,
        params: {
          id: "op1",
        },
      });

      // Add operations
      storage.populateOperations(sampleOperations);

      // Verify callback was called with checkpoint operations and populated operations
      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [operation]);
    });

    it("should notify wait manager for multiple populated operations", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const mockOperation1 = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );
      const mockOperation2 = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      // Register the mock operations
      storage.registerOperation({
        operation: mockOperation1,
        params: {
          id: "op1",
        },
      });
      storage.registerOperation({
        operation: mockOperation2,
        params: {
          id: "op2",
        },
      });

      // Add operations
      storage.populateOperations(sampleOperations);

      // Verify callback was called with both populated operations
      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [
        mockOperation1,
        mockOperation2,
      ]);
    });
  });

  describe("registerOperation", () => {
    it("should register a operation", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      storage.registerOperation({
        operation: operation,
        params: {
          name: "test-op",
        },
      });

      // Add operations after registration
      storage.populateOperations([
        {
          operation: {
            Id: "test-id",
            Name: "test-op",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);

      // The operation should have data populated
      expect(operation.getOperationData()).toEqual({
        Id: "test-id",
        Name: "test-op",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      });
    });

    it("should populate operation data if matching operation exists", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      // Add operations first
      storage.populateOperations(sampleOperations);

      // Then register a operation with matching ID
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );
      storage.registerOperation({
        operation: operation,
        params: {
          id: "op2",
        },
      });

      // The operation should have data populated immediately
      expect(operation.getOperationData()).toEqual({
        ...sampleOperations[1].operation,
      });
    });

    it("should handle mock operations with empty string id", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      ); // Empty string is falsy but valid

      storage.registerOperation({
        operation: operation,
        params: {
          id: "",
        },
      });

      // Add operations with empty string ID
      storage.populateOperations([
        {
          operation: {
            Id: "", // Empty string ID
            Name: "test-op",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);

      // The operation should have data populated
      expect(operation.getOperationData()).toEqual({
        Id: "",
        Name: "test-op",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      });
    });

    it("should handle mock operations with empty string name", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      ); // Empty string is falsy but valid

      storage.registerOperation({
        operation: operation,
        params: {
          name: "",
        },
      });

      // Add operations with empty string name
      storage.populateOperations([
        {
          operation: {
            Id: "test-id",
            Type: OperationType.STEP,
            Name: "", // Empty string name
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);

      // The operation should have data populated
      expect(operation.getOperationData()).toEqual({
        Id: "test-id",
        Name: "",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      });
    });

    it("should handle mock operations with index 0", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      ); // 0 is falsy but valid index

      storage.registerOperation({
        operation: operation,
        params: {
          index: 0,
        },
      });

      // Add operations
      storage.populateOperations([
        {
          operation: {
            Id: "first-op",
            Name: "operation-at-index-0",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [],
        },
        {
          operation: {
            Id: "second-op",
            Name: "operation-at-index-1",
            Type: OperationType.WAIT,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);

      // The operation should have data populated with the first operation (index 0)
      expect(operation.getOperationData()).toEqual({
        Id: "first-op",
        Name: "operation-at-index-0",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      });
    });

    it("should notify wait manager when registering operations with existing data", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      // Add operations first
      storage.populateOperations(sampleOperations);

      // Then register a operation with matching ID
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );
      storage.registerOperation({
        operation: operation,
        params: {
          id: "op2",
        },
      });

      // The operation should have been populated immediately since data exists
      expect(operation.getOperationData()).toEqual({
        ...sampleOperations[1].operation,
      });
    });
  });

  describe("Callback functionality edge cases", () => {
    it("should always call callback since it is required", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      storage.registerOperation({
        operation: operation,
        params: {
          name: "nonexistent",
        },
      });
      storage.populateOperations(sampleOperations);

      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [operation]);
    });

    it("should call callback with empty populated operations when no operations are populated", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      storage.registerOperation({
        operation: operation,
        params: {
          name: "nonexistent",
        },
      });
      storage.populateOperations(sampleOperations);

      // Callback should be called with empty populated operations array
      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [operation]);
    });

    it("should call callback with empty arrays when no operations provided", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      // Populate with empty array
      storage.populateOperations([]);

      // Callback should not be called when no operations provided
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it("should call callback for all operations that are registered", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );
      const populatedOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );
      const nonPopulatedOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );

      storage.registerOperation({
        operation: populatedOperation,
        params: {
          id: "op1",
        },
      });
      storage.registerOperation({
        operation: nonPopulatedOperation,
        params: {
          name: "nonexistent",
        },
      });
      storage.populateOperations(sampleOperations);

      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [
        populatedOperation,
        nonPopulatedOperation,
      ]);
    });

    it("should call callback when registering operation with existing data", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      // Populate operations first
      storage.populateOperations(sampleOperations);
      mockCallback.mockClear(); // Clear previous calls

      // Register operation that matches existing data
      const operation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
      );
      storage.registerOperation({
        operation: operation,
        params: {
          id: "op1",
        },
      });

      // The operation should be populated immediately, but callback is only called from populateOperations
      expect(operation.getOperationData()).toEqual({
        ...sampleOperations[0].operation,
      });
      // Callback should not be called during registration
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("getHistoryEvents", () => {
    it("should return history events from populated operations", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      storage.populateOperations(sampleOperations);
      expect(storage.getHistoryEvents()).toEqual(
        sampleOperations.flatMap((op) => op.events),
      );
    });

    it("should return history events from indexed operations", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        new IndexedOperations(sampleOperations),
        mockDurableApiClient,
        mockCallback,
      );

      expect(storage.getHistoryEvents()).toEqual(
        sampleOperations.flatMap((op) => op.events),
      );
    });

    it("should return history events from both indexed operations and populated operations", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        new IndexedOperations(sampleOperations),
        mockDurableApiClient,
        mockCallback,
      );

      const populatedOperations = sampleOperations.concat([
        {
          operation: {
            Id: "op4",
            Status: "STARTED",
            Type: "CALLBACK",
            StartTimestamp: undefined,
          },
          events: [
            {
              EventId: 5,
              EventType: EventType.CallbackStarted,
            },
          ],
        } satisfies OperationEvents,
      ]);

      storage.populateOperations(populatedOperations);

      const historyEvents = populatedOperations.flatMap((op) => op.events);

      expect(storage.getHistoryEvents()).toEqual(historyEvents);
    });
  });
});
