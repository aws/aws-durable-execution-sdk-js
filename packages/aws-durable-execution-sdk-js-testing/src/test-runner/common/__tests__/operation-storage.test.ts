import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { OperationStorage } from "../operation-storage";
import { OperationWaitManager } from "../../local/operations/operation-wait-manager";
import { IndexedOperations } from "../indexed-operations";
import { OperationEvents } from "../operations/operation-with-data";

// Mock the OperationWaitManager
jest.mock("../../local/operations/operation-wait-manager");

describe("OperationStorage", () => {
  let mockWaitManager: OperationWaitManager;
  let mockIndexedOperations: IndexedOperations;

  // Sample operations for testing
  const sampleOperations: OperationEvents[] = [
    {
      operation: {
        Id: "op1",
        Name: "operation1",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      },
      events: [],
    },
    {
      operation: {
        Id: "op2",
        Name: "operation2",
        Type: OperationType.WAIT,
        Status: OperationStatus.SUCCEEDED,
      },
      events: [],
    },
    {
      operation: {
        Id: "op3",
        Name: "operation1", // Same name as first operation
        Type: OperationType.CALLBACK,
        Status: OperationStatus.FAILED,
      },
      events: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitManager = new OperationWaitManager();
    mockIndexedOperations = new IndexedOperations([]);
  });

  describe("constructor", () => {
    it("should initialize with empty operations", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations
      );

      expect(storage.getOperations()).toEqual([]);
    });
  });

  describe("getOperations", () => {
    it("should return all operations after they have been populated", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations
      );

      storage.populateOperations(sampleOperations);

      expect(storage.getOperations()).toHaveLength(
        sampleOperations.length
      );
    });

    it("should not return execution operations", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations
      );

      storage.populateOperations(
        sampleOperations.concat({
          operation: {
            Id: "Execution-operation-id",
            Type: OperationType.EXECUTION,
          },
          events: [],
        })
      );

      expect(storage.getOperations()).toHaveLength(
        sampleOperations.length
      );
    });
  });

  describe("populateOperations", () => {
    it("should add operations to storage", () => {
      const storage = new OperationStorage(
        mockWaitManager,
        mockIndexedOperations
      );

      storage.populateOperations(sampleOperations);

      expect(storage.getOperations()).toHaveLength(
        sampleOperations.length
      );
    });
  });
});
