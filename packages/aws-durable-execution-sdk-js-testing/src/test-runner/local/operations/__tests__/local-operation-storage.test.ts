import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { LocalOperationStorage } from "../local-operation-storage";
import { OperationWaitManager } from "../operation-wait-manager";
import { MockOperation } from "../mock-operation";
import { createExecutionId } from "../../../../checkpoint-server/utils/tagged-strings";
import { IndexedOperations } from "../../../common/indexed-operations";
import { OperationEvents } from "../../../common/operations/operation-with-data";

// Mock the OperationWaitManager
jest.mock("../operation-wait-manager");

describe("LocalOperationStorage", () => {
  let mockWaitManager: OperationWaitManager;
  let mockIndexedOperations: IndexedOperations;
  let mockCallback: jest.Mock;

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
    mockCallback = jest.fn();
  });

  describe("populateOperations", () => {

    it("should update registered mock operations with matching ID", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { id: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );

      // Register the mock operation
      storage.registerOperation(mockOperation);

      // Initially no data is populated
      expect(mockOperation.getOperationData()).toBeUndefined();

      // Add operations
      storage.populateOperations(sampleOperations);

      // Now the mock operation should have data
      expect(mockOperation.getOperationData()).toEqual({
        ...sampleOperations[0].operation,
      });
    });

    it("should update registered mock operations with matching name and index", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { name: "operation1", index: 1 },
        mockWaitManager,
        mockIndexedOperations
      );

      // Register the mock operation
      storage.registerOperation(mockOperation);

      // Initially no data is populated
      expect(mockOperation.getOperationData()).toBeUndefined();

      // Add operations
      storage.populateOperations(sampleOperations);

      // Now the mock operation should have data (the second operation with name "operation1")
      expect(mockOperation.getOperationData()).toEqual({
        ...sampleOperations[2].operation,
      });
    });

    it("should update registered mock operations with matching index only", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { index: 1 },
        mockWaitManager,
        mockIndexedOperations
      );

      // Register the mock operation
      storage.registerOperation(mockOperation);

      // Initially no data is populated
      expect(mockOperation.getOperationData()).toBeUndefined();

      // Add operations
      storage.populateOperations(sampleOperations);

      // Now the mock operation should have data (index 1)
      expect(mockOperation.getOperationData()).toEqual({
        ...sampleOperations[1].operation,
      });
    });

    it("should not throw for mock operations without matching operation data", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { name: "nonexistent" },
        mockWaitManager,
        mockIndexedOperations
      );

      // Register the mock operation
      storage.registerOperation(mockOperation);

      // Add operations
      expect(() => {
        storage.populateOperations(sampleOperations);
      }).not.toThrow();

      // The mock operation should still have no data
      expect(mockOperation.getOperationData()).toBeUndefined();
    });

    it("should notify wait manager when operations are populated", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { id: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );

      // Register the mock operation
      storage.registerOperation(mockOperation);

      // Add operations
      storage.populateOperations(sampleOperations);

      // Verify callback was called with checkpoint operations and populated operations
      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [
        mockOperation,
      ]);
    });

    it("should notify wait manager for multiple populated operations", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation1 = new MockOperation(
        { id: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );
      const mockOperation2 = new MockOperation(
        { id: "op2" },
        mockWaitManager,
        mockIndexedOperations
      );

      // Register the mock operations
      storage.registerOperation(mockOperation1);
      storage.registerOperation(mockOperation2);

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
    it("should register a mock operation", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { name: "test-op" },
        mockWaitManager,
        mockIndexedOperations
      );

      storage.registerOperation(mockOperation);

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

      // The mock operation should have data populated
      expect(mockOperation.getOperationData()).toEqual({
        Id: "test-id",
        Name: "test-op",
        Type: OperationType.STEP,
        Status: OperationStatus.SUCCEEDED,
      });
    });

    it("should populate mock operation data if matching operation exists", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );

      // Add operations first
      storage.populateOperations(sampleOperations);

      // Then register a mock operation with matching ID
      const mockOperation = new MockOperation(
        { id: "op2" },
        mockWaitManager,
        mockIndexedOperations
      );
      storage.registerOperation(mockOperation);

      // The mock operation should have data populated immediately
      expect(mockOperation.getOperationData()).toEqual({
        ...sampleOperations[1].operation,
      });
    });

    it("should handle mock operations with empty string id", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { id: "" },
        mockWaitManager,
        mockIndexedOperations
      ); // Empty string is falsy but valid

      storage.registerOperation(mockOperation);

      // Add operations with empty string ID
      storage.populateOperations([
        {
          operation: {
            Id: "", // Empty string ID
            Name: "test-op",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
          },
          events: [],
        },
      ]);

      // The mock operation should have data populated
      expect(mockOperation.getOperationData()).toEqual({
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
        mockCallback
      );
      const mockOperation = new MockOperation(
        { name: "" },
        mockWaitManager,
        mockIndexedOperations
      ); // Empty string is falsy but valid

      storage.registerOperation(mockOperation);

      // Add operations with empty string name
      storage.populateOperations([
        {
          operation: {
            Id: "test-id",
            Type: OperationType.STEP,
            Name: "", // Empty string name
            Status: OperationStatus.SUCCEEDED,
          },
          events: [],
        },
      ]);

      // The mock operation should have data populated
      expect(mockOperation.getOperationData()).toEqual({
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
        mockCallback
      );
      const mockOperation = new MockOperation(
        { index: 0 },
        mockWaitManager,
        mockIndexedOperations
      ); // 0 is falsy but valid index

      storage.registerOperation(mockOperation);

      // Add operations
      storage.populateOperations([
        {
          operation: {
            Id: "first-op",
            Name: "operation-at-index-0",
            Type: OperationType.STEP,
            Status: OperationStatus.SUCCEEDED,
          },
          events: [],
        },
        {
          operation: {
            Id: "second-op",
            Name: "operation-at-index-1",
            Type: OperationType.WAIT,
            Status: OperationStatus.SUCCEEDED,
          },
          events: [],
        },
      ]);

      // The mock operation should have data populated with the first operation (index 0)
      expect(mockOperation.getOperationData()).toEqual({
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
        mockCallback
      );

      // Add operations first
      storage.populateOperations(sampleOperations);

      // Then register a mock operation with matching ID
      const mockOperation = new MockOperation(
        { id: "op2" },
        mockWaitManager,
        mockIndexedOperations
      );
      storage.registerOperation(mockOperation);

      // The mock operation should have been populated immediately since data exists
      expect(mockOperation.getOperationData()).toEqual({
        ...sampleOperations[1].operation,
      });
    });
  });

  describe("registerMocks", () => {
    it("should call registerMocks on all registered mock operations", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation1 = new MockOperation(
        { name: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );
      const mockOperation2 = new MockOperation(
        { name: "op2" },
        mockWaitManager,
        mockIndexedOperations
      );
      const mockOperation3 = new MockOperation(
        { index: 0 },
        mockWaitManager,
        mockIndexedOperations
      );

      // Spy on the registerMocks method of each mock operation
      const registerMocksSpy1 = jest.spyOn(mockOperation1, "registerMocks");
      const registerMocksSpy2 = jest.spyOn(mockOperation2, "registerMocks");
      const registerMocksSpy3 = jest.spyOn(mockOperation3, "registerMocks");

      // Register the mock operations
      storage.registerOperation(mockOperation1);
      storage.registerOperation(mockOperation2);
      storage.registerOperation(mockOperation3);

      const executionId = createExecutionId("test-execution-id");

      // Call registerMocks
      storage.registerMocks(executionId);

      // Verify that registerMocks was called on all mock operations with the correct executionId
      expect(registerMocksSpy1).toHaveBeenCalledWith(executionId);
      expect(registerMocksSpy2).toHaveBeenCalledWith(executionId);
      expect(registerMocksSpy3).toHaveBeenCalledWith(executionId);
      expect(registerMocksSpy1).toHaveBeenCalledTimes(1);
      expect(registerMocksSpy2).toHaveBeenCalledTimes(1);
      expect(registerMocksSpy3).toHaveBeenCalledTimes(1);
    });

    it("should not throw when no mock operations are registered", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );

      const executionId = createExecutionId("test-execution-id");

      // Should not throw even with no registered operations
      expect(() => {
        storage.registerMocks(executionId);
      }).not.toThrow();
    });

    it("should handle mixed types of mock operations", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const idBasedMock = new MockOperation(
        { id: "test-id" },
        mockWaitManager,
        mockIndexedOperations
      );
      const nameBasedMock = new MockOperation(
        { name: "test-name", index: 1 },
        mockWaitManager,
        mockIndexedOperations
      );
      const indexBasedMock = new MockOperation(
        { index: 2 },
        mockWaitManager,
        mockIndexedOperations
      );

      // Spy on registerMocks methods
      const idMockSpy = jest.spyOn(idBasedMock, "registerMocks");
      const nameMockSpy = jest.spyOn(nameBasedMock, "registerMocks");
      const indexMockSpy = jest.spyOn(indexBasedMock, "registerMocks");

      // Register different types of mock operations
      storage.registerOperation(idBasedMock);
      storage.registerOperation(nameBasedMock);
      storage.registerOperation(indexBasedMock);

      const executionId = createExecutionId("mixed-execution-id");

      // Call registerMocks
      storage.registerMocks(executionId);

      // All should be called regardless of their type
      expect(idMockSpy).toHaveBeenCalledWith(executionId);
      expect(nameMockSpy).toHaveBeenCalledWith(executionId);
      expect(indexMockSpy).toHaveBeenCalledWith(executionId);
    });

    it("should call registerMocks even if mock operations are not populated with data", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { name: "nonexistent-op" },
        mockWaitManager,
        mockIndexedOperations
      );

      const registerMocksSpy = jest.spyOn(mockOperation, "registerMocks");

      // Register a mock operation that won't match any real operations
      storage.registerOperation(mockOperation);

      // Populate with operations that don't match
      storage.populateOperations(sampleOperations);

      const executionId = createExecutionId("test-execution-id");

      // registerMocks should still be called even though the operation has no data
      storage.registerMocks(executionId);

      expect(registerMocksSpy).toHaveBeenCalledWith(executionId);
      expect(registerMocksSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Callback functionality edge cases", () => {
    it("should always call callback since it is required", () => {
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { id: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );

      storage.registerOperation(mockOperation);
      storage.populateOperations(sampleOperations);

      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, [
        mockOperation,
      ]);
    });

    it("should call callback with empty populated operations when no operations are populated", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const mockOperation = new MockOperation(
        { name: "nonexistent" },
        mockWaitManager,
        mockIndexedOperations
      );

      storage.registerOperation(mockOperation);
      storage.populateOperations(sampleOperations);

      // Callback should be called with empty populated operations array
      expect(mockCallback).toHaveBeenCalledWith(sampleOperations, []);
    });

    it("should call callback with empty arrays when no operations provided", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );

      // Populate with empty array
      storage.populateOperations([]);

      // Callback should not be called when no operations provided
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it("should call callback only for operations that actually got populated", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );
      const populatedOperation = new MockOperation(
        { id: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );
      const nonPopulatedOperation = new MockOperation(
        { name: "nonexistent" },
        mockWaitManager,
        mockIndexedOperations
      );

      storage.registerOperation(populatedOperation);
      storage.registerOperation(nonPopulatedOperation);
      storage.populateOperations(sampleOperations);

      // Callback should only include the operation that actually got populated
      expect(mockCallback).toHaveBeenCalledWith(
        sampleOperations,
        [populatedOperation] // Only the populated one
      );
    });

    it("should call callback when registering operation with existing data", () => {
      const mockCallback = jest.fn();
      const storage = new LocalOperationStorage(
        mockWaitManager,
        mockIndexedOperations,
        mockCallback
      );

      // Populate operations first
      storage.populateOperations(sampleOperations);
      mockCallback.mockClear(); // Clear previous calls

      // Register operation that matches existing data
      const mockOperation = new MockOperation(
        { id: "op1" },
        mockWaitManager,
        mockIndexedOperations
      );
      storage.registerOperation(mockOperation);

      // The operation should be populated immediately, but callback is only called from populateOperations
      expect(mockOperation.getOperationData()).toEqual({
        ...sampleOperations[0].operation,
      });
      // Callback should not be called during registration
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });
});
