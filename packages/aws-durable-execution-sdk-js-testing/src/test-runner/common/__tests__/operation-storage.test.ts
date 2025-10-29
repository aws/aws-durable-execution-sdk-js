import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { OperationStorage, TrackedOperation } from "../operation-storage";
import { OperationWaitManager } from "../../local/operations/operation-wait-manager";
import { IndexedOperations } from "../indexed-operations";
import {
  OperationEvents,
  OperationWithData,
} from "../operations/operation-with-data";
import { DurableApiClient } from "../create-durable-api-client";

// Mock the OperationWaitManager
jest.mock("../../local/operations/operation-wait-manager");

describe("OperationStorage", () => {
  let mockWaitManager: OperationWaitManager;
  let mockIndexedOperations: IndexedOperations;
  let mockApiClient: DurableApiClient;

  // Sample operations for testing
  const sampleOperations: OperationEvents[] = [
    {
      operation: {
        Id: "op1",
        Name: "operation1",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: new Date(),
      },
      events: [],
    },
    {
      operation: {
        Id: "op2",
        Name: "operation2",
        Type: OperationType.WAIT,
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: new Date(),
      },
      events: [],
    },
    {
      operation: {
        Id: "op3",
        Name: "operation1", // Same name as first operation
        Type: OperationType.CALLBACK,
        Status: OperationStatus.FAILED,
        StartTimestamp: new Date(),
      },
      events: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitManager = new OperationWaitManager();
    mockIndexedOperations = new IndexedOperations([]);
    mockApiClient = {} as DurableApiClient;
  });

  describe("constructor", () => {
    it("should initialize with empty operations", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      expect(storage.getOperations()).toEqual([]);
    });
  });

  describe("getOperations", () => {
    it("should return all operations after they have been populated", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      storage.populateOperations(sampleOperations);

      expect(storage.getOperations()).toHaveLength(sampleOperations.length);
    });

    it("should not return execution operations", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      storage.populateOperations(
        sampleOperations.concat({
          operation: {
            Id: "Execution-operation-id",
            Type: OperationType.EXECUTION,
            StartTimestamp: new Date(),
            Status: OperationStatus.STARTED,
          },
          events: [],
        }),
      );

      expect(storage.getOperations()).toHaveLength(sampleOperations.length);
    });
  });

  describe("populateOperations", () => {
    it("should add operations to storage", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      storage.populateOperations(sampleOperations);

      expect(storage.getOperations()).toHaveLength(sampleOperations.length);
    });

    it("should return early if no operations provided", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      const initialOperationsCount = storage.getOperations().length;

      storage.populateOperations([]);

      expect(storage.getOperations()).toHaveLength(initialOperationsCount);
    });

    it("should repopulate tracked operations after adding new checkpoint operations", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      // Create a mock tracked operation
      const mockOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const trackedOperation: TrackedOperation<OperationWithData> = {
        operation: mockOperation,
        params: { id: "op1" },
      };

      storage.registerOperation(trackedOperation);
      storage.populateOperations(sampleOperations);

      expect(storage.getTrackedOperations()).toHaveLength(1);
      expect(storage.getOperations()).toHaveLength(sampleOperations.length);
    });
  });

  describe("getTrackedOperations", () => {
    it("should return empty array when no operations are registered", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      expect(storage.getTrackedOperations()).toEqual([]);
    });

    it("should return all tracked operations after registration", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      const mockOperation1 = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const mockOperation2 = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      const trackedOperation1: TrackedOperation<OperationWithData> = {
        operation: mockOperation1,
        params: { id: "op1" },
      };
      const trackedOperation2: TrackedOperation<OperationWithData> = {
        operation: mockOperation2,
        params: { name: "operation2", index: 0 },
      };

      storage.registerOperation(trackedOperation1);
      storage.registerOperation(trackedOperation2);

      const trackedOps = storage.getTrackedOperations();
      expect(trackedOps).toHaveLength(2);
      expect(trackedOps).toContain(mockOperation1);
      expect(trackedOps).toContain(mockOperation2);
    });
  });

  describe("registerOperation", () => {
    it("should register a tracked operation", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      const mockOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const trackedOperation: TrackedOperation<OperationWithData> = {
        operation: mockOperation,
        params: { id: "op1" },
      };

      storage.registerOperation(trackedOperation);

      const trackedOps = storage.getTrackedOperations();
      expect(trackedOps).toHaveLength(1);
      expect(trackedOps[0]).toBe(mockOperation);
    });

    it("should populate operation data by id when operation exists", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      // First populate operations so they can be found
      storage.populateOperations(sampleOperations);

      const mockOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const populateDataSpy = jest.spyOn(mockOperation, "populateData");

      const trackedOperation: TrackedOperation<OperationWithData> = {
        operation: mockOperation,
        params: { id: "op1" },
      };

      storage.registerOperation(trackedOperation);

      expect(populateDataSpy).toHaveBeenCalledWith(sampleOperations[0]);
    });

    it("should populate operation data by name and index when operation exists", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      // First populate operations so they can be found
      storage.populateOperations(sampleOperations);

      const mockOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const populateDataSpy = jest.spyOn(mockOperation, "populateData");

      const trackedOperation: TrackedOperation<OperationWithData> = {
        operation: mockOperation,
        params: { name: "operation1", index: 1 },
      };

      storage.registerOperation(trackedOperation);

      // Should find the second operation with name "operation1" (op3)
      expect(populateDataSpy).toHaveBeenCalledWith(sampleOperations[2]);
    });

    it("should populate operation data by index when operation exists", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      // First populate operations so they can be found
      storage.populateOperations(sampleOperations);

      const mockOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const populateDataSpy = jest.spyOn(mockOperation, "populateData");

      const trackedOperation: TrackedOperation<OperationWithData> = {
        operation: mockOperation,
        params: { index: 1 },
      };

      storage.registerOperation(trackedOperation);

      expect(populateDataSpy).toHaveBeenCalledWith(sampleOperations[1]);
    });

    it("should not populate operation data when no matching operation is found", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );

      const mockOperation = new OperationWithData(
        mockWaitManager,
        mockIndexedOperations,
        mockApiClient,
      );
      const populateDataSpy = jest.spyOn(mockOperation, "populateData");

      const trackedOperation: TrackedOperation<OperationWithData> = {
        operation: mockOperation,
        params: { id: "nonexistent" },
      };

      storage.registerOperation(trackedOperation);

      expect(populateDataSpy).not.toHaveBeenCalled();
    });

    describe("populateOperation priority behavior", () => {
      it("should not populate by index if name is defined", () => {
        const storage = new OperationStorage(
          mockWaitManager,
          mockIndexedOperations,
          mockApiClient,
        );

        storage.populateOperations(sampleOperations);

        const mockOperation = new OperationWithData(
          mockWaitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const populateDataSpy = jest.spyOn(mockOperation, "populateData");

        // Mock the IndexedOperations to track which lookup methods are called
        const getByIdSpy = jest.spyOn(mockIndexedOperations, "getById");
        const getByNameAndIndexSpy = jest.spyOn(
          mockIndexedOperations,
          "getByNameAndIndex",
        );
        const getByIndexSpy = jest.spyOn(mockIndexedOperations, "getByIndex");

        const trackedOperation: TrackedOperation<OperationWithData> = {
          operation: mockOperation,
          params: {
            // id is undefined
            name: "operation1", // Name is defined
            index: 0, // Index is also defined but should be ignored in favor of name
          },
        };

        storage.registerOperation(trackedOperation);

        expect(getByIdSpy).not.toHaveBeenCalled();
        expect(getByNameAndIndexSpy).toHaveBeenCalledWith("operation1", 0);
        expect(getByIndexSpy).not.toHaveBeenCalled();
        expect(populateDataSpy).toHaveBeenCalledWith(sampleOperations[0]);
      });

      it("should populate by index only when both name and id are undefined", () => {
        const storage = new OperationStorage(
          mockWaitManager,
          mockIndexedOperations,
          mockApiClient,
        );

        storage.populateOperations(sampleOperations);

        const mockOperation = new OperationWithData(
          mockWaitManager,
          mockIndexedOperations,
          mockApiClient,
        );
        const populateDataSpy = jest.spyOn(mockOperation, "populateData");

        // Mock the IndexedOperations to track which lookup methods are called
        const getByIdSpy = jest.spyOn(mockIndexedOperations, "getById");
        const getByNameAndIndexSpy = jest.spyOn(
          mockIndexedOperations,
          "getByNameAndIndex",
        );
        const getByIndexSpy = jest.spyOn(mockIndexedOperations, "getByIndex");

        const trackedOperation: TrackedOperation<OperationWithData> = {
          operation: mockOperation,
          params: {
            // id is undefined
            // name is undefined
            index: 1, // Only index is defined
          },
        };

        storage.registerOperation(trackedOperation);

        // Should skip getById since id is undefined, skip getByNameAndIndex since name is undefined, then use getByIndex
        expect(getByIdSpy).not.toHaveBeenCalled();
        expect(getByNameAndIndexSpy).not.toHaveBeenCalled();
        expect(getByIndexSpy).toHaveBeenCalledWith(1);
        expect(populateDataSpy).toHaveBeenCalledWith(sampleOperations[1]);
      });
    });
  });
});
