import {
  EventType,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { LocalOperationStorage } from "../local-operation-storage";
import { OperationWaitManager } from "../operation-wait-manager";
import { OperationWithData } from "../../../common/operations/operation-with-data";
import { IndexedOperations } from "../../../common/indexed-operations";
import { OperationEvents } from "../../../common/operations/operation-with-data";
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
      },
      events: [
        {
          EventId: 3,
          EventType: EventType.WaitStarted,
          EventTimestamp: new Date("2026-01-01"),
          WaitStartedDetails: {
            Duration: 10,
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
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitManager = new OperationWaitManager();
    mockIndexedOperations = new IndexedOperations([]);
    mockCallback = jest.fn();
    mockDurableApiClient = {
      sendCallbackSuccess: jest.fn(),
      sendCallbackFailure: jest.fn(),
      sendCallbackHeartbeat: jest.fn(),
    };
  });

  describe("constructor", () => {
    it("should initialize with required dependencies", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      expect(storage).toBeDefined();
      expect(storage.getHistoryEvents()).toEqual([]);
    });

    it("should initialize with existing operations from IndexedOperations", () => {
      const indexedOps = new IndexedOperations(sampleOperations);
      const storage = new LocalOperationStorage(
        mockWaitManager,
        indexedOps,
        mockDurableApiClient,
        mockCallback,
      );

      expect(storage.getHistoryEvents()).toEqual(
        sampleOperations.flatMap((op) => op.events),
      );
    });
  });

  describe("populateOperations", () => {
    it("should update registered operations with new data", () => {
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

    it("should notify callback when operations are populated", () => {
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
          id: "op1",
        },
      });

      storage.populateOperations(sampleOperations);

      // Verify callback was called with checkpoint operations and operations
      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [operation]);
    });

    it("should not call callback when no operations are provided", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockDurableApiClient,
        mockCallback,
      );

      storage.populateOperations([]);

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("registerOperation", () => {
    it("should register an operation", () => {
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

      // Then register an operation with matching ID
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

    it("should update history events when new operations are populated", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        new IndexedOperations(sampleOperations),
        mockDurableApiClient,
        mockCallback,
      );

      const newOperation: OperationEvents = {
        operation: {
          Id: "op3",
          Status: OperationStatus.SUCCEEDED,
          Type: OperationType.CALLBACK,
        },
        events: [
          {
            EventId: 5,
            EventType: EventType.CallbackStarted,
          },
        ],
      };

      const populatedOperations = sampleOperations.concat([newOperation]);
      storage.populateOperations(populatedOperations);

      const historyEvents = populatedOperations.flatMap((op) => op.events);
      expect(storage.getHistoryEvents()).toEqual(historyEvents);
    });
  });
});
