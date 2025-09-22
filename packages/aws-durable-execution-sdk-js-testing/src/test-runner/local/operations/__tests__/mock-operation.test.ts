import { MockOperation, MockOperationParameters } from "../mock-operation";
import { OperationInterceptor } from "aws-durable-execution-sdk-js";
import { createExecutionId } from "../../../../checkpoint-server/utils/tagged-strings";
import { OperationWaitManager } from "../operation-wait-manager";
import { IndexedOperations } from "../../../common/indexed-operations";

describe("MockOperation", () => {
  const waitManager = new OperationWaitManager();
  const mockIndexedOperations = new IndexedOperations([]);
  jest.spyOn(waitManager, "waitForOperation");

  describe("constructor", () => {
    it("should initialize with name", () => {
      const params: MockOperationParameters = { name: "test-operation" };
      const operation = new MockOperation(params, waitManager, mockIndexedOperations);

      expect(operation._mockName).toBe(params.name);
      expect(operation._mockIndex).toBeUndefined();
      expect(operation._mockId).toBeUndefined();
    });

    it("should initialize with index", () => {
      const params: MockOperationParameters = { index: 5 };
      const operation = new MockOperation(params, waitManager, mockIndexedOperations);

      expect(operation._mockName).toBeUndefined();
      expect(operation._mockIndex).toBe(params.index);
      expect(operation._mockId).toBeUndefined();
    });

    it("should initialize with id", () => {
      const params: MockOperationParameters = { id: "op-123" };
      const operation = new MockOperation(params, waitManager, mockIndexedOperations);

      expect(operation._mockName).toBeUndefined();
      expect(operation._mockIndex).toBeUndefined();
      expect(operation._mockId).toBe(params.id);
    });

    it("should initialize with all parameters", () => {
      const params: MockOperationParameters = {
        name: "test-operation",
        index: 5,
        id: "op-123",
      };
      const operation = new MockOperation(params, waitManager, mockIndexedOperations);

      expect(operation._mockName).toBe(params.name);
      expect(operation._mockIndex).toBe(params.index);
      expect(operation._mockId).toBe(params.id);
    });
  });

  describe("mocking functionality", () => {
    describe("mockImplementation", () => {
      it("should register name-based mock with custom implementation", () => {
        const operation = new MockOperation(
          {
            name: "test-operation",
            index: 2,
          },
          waitManager,
          mockIndexedOperations
        );
        const mockFn = jest.fn(() => Promise.resolve({ custom: "result" }));

        const result = operation.mockImplementation(mockFn);

        expect(result).toBe(operation); // Should return this for chaining
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getNameMockCount()).toBe(1);
        expect(operation.getIndexMockCount()).toBe(0);
      });

      it("should register index-based mock with custom implementation", () => {
        const operation = new MockOperation({ index: 5 }, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({ custom: "result" }));

        const result = operation.mockImplementation(mockFn);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getNameMockCount()).toBe(0);
        expect(operation.getIndexMockCount()).toBe(1);
      });

      it("should throw error when trying to mock with ID", () => {
        const operation = new MockOperation({ id: "op-123" }, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({}));

        expect(() => operation.mockImplementation(mockFn)).toThrow(
          "Mocking for ids is not supported"
        );
      });

      it("should throw error when missing name and index", () => {
        const operation = new MockOperation({}, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({}));

        expect(() => operation.mockImplementation(mockFn)).toThrow(
          "Failed to mock implementation with missing name and index"
        );
      });

      it("should prefer name over index when both are provided", () => {
        const operation = new MockOperation(
          { name: "test-op", index: 3 },
          waitManager,
          mockIndexedOperations
        );
        const mockFn = jest.fn(() => Promise.resolve({}));

        operation.mockImplementation(mockFn);

        expect(operation.getNameMockCount()).toBe(1);
        expect(operation.getIndexMockCount()).toBe(0);
      });
    });

    describe("mockImplementationOnce", () => {
      it("should register name-based mock with count=1", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );
        const mockFn = jest.fn(() => Promise.resolve({ once: "result" }));

        const result = operation.mockImplementationOnce(mockFn);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getNameMockCount()).toBe(1);
      });

      it("should register index-based mock with count=1", () => {
        const operation = new MockOperation({ index: 7 }, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({ once: "result" }));

        const result = operation.mockImplementationOnce(mockFn);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getIndexMockCount()).toBe(1);
      });

      it("should throw error when trying to mock with ID", () => {
        const operation = new MockOperation({ id: "op-456" }, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({}));

        expect(() => operation.mockImplementationOnce(mockFn)).toThrow(
          "Mocking for ids is not supported"
        );
      });

      it("should throw error when missing name and index", () => {
        const operation = new MockOperation({}, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({}));

        expect(() => operation.mockImplementationOnce(mockFn)).toThrow(
          "Failed to mock implementation with missing name and index"
        );
      });
    });

    describe("mockResolvedValue", () => {
      it("should create mock that resolves to specified value", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );
        const testValue = { data: "test-result" };

        const result = operation.mockResolvedValue(testValue);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getMockCount()).toBe(1);
      });

      it("should work with primitive values", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );

        const result = operation.mockResolvedValue("simple string");

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
      });

      it("should work with null and undefined", () => {
        const operation1 = new MockOperation({ name: "null-op" }, waitManager, mockIndexedOperations);
        const operation2 = new MockOperation(
          { name: "undefined-op" },
          waitManager,
          mockIndexedOperations
        );

        operation1.mockResolvedValue(null);
        operation2.mockResolvedValue(undefined);

        expect(operation1.hasMocks()).toBe(true);
        expect(operation2.hasMocks()).toBe(true);
      });
    });

    describe("mockRejectedValue", () => {
      it("should create mock that rejects with specified error", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );
        const testError = new Error("Test error message");

        const result = operation.mockRejectedValue(testError);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getMockCount()).toBe(1);
      });

      it("should work with string errors", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );

        const result = operation.mockRejectedValue("String error");

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
      });

      it("should work with any error type", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );
        const customError = { code: 500, message: "Custom error" };

        const result = operation.mockRejectedValue(customError);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
      });
    });

    describe("mockRejectedValueOnce", () => {
      it("should create single-use mock that rejects with specified error", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );
        const testError = new Error("Once error");

        const result = operation.mockRejectedValueOnce(testError);

        expect(result).toBe(operation);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getMockCount()).toBe(1);
      });
    });

    describe("registerMocks", () => {
      let mockForExecution: jest.SpyInstance;
      let mockChain: {
        onName: jest.Mock;
        onIndex: jest.Mock;
        mock: jest.Mock;
      };

      beforeEach(() => {
        mockChain = {
          onName: jest.fn().mockReturnThis(),
          onIndex: jest.fn().mockReturnThis(),
          mock: jest.fn(),
        };
        mockForExecution = jest
          .spyOn(OperationInterceptor, "forExecution")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
          .mockReturnValue(mockChain as any);
      });

      afterEach(() => {
        mockForExecution.mockRestore();
      });

      it("should register name-based mocks with Mock system", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );
        const mockFn = jest.fn(() => Promise.resolve({}));
        const executionId = createExecutionId();

        operation.mockImplementation(mockFn);
        operation.registerMocks(executionId);

        expect(mockForExecution).toHaveBeenCalledWith(executionId);
        expect(mockChain.onName).toHaveBeenCalledWith(
          "test-operation",
          undefined
        );
        expect(mockChain.mock).toHaveBeenCalledWith(mockFn, Infinity);
      });

      it("should register index-based mocks with Mock system", () => {
        const operation = new MockOperation({ index: 5 }, waitManager, mockIndexedOperations);
        const mockFn = jest.fn(() => Promise.resolve({}));
        const executionId = createExecutionId();

        operation.mockImplementation(mockFn);
        operation.registerMocks(executionId);

        expect(mockForExecution).toHaveBeenCalledWith(executionId);
        expect(mockChain.onIndex).toHaveBeenCalledWith(5);
        expect(mockChain.mock).toHaveBeenCalledWith(mockFn, Infinity);
      });

      it("should register multiple mocks", () => {
        const operation = new MockOperation({ name: "multi-op" }, waitManager, mockIndexedOperations);
        const mockFn1 = jest.fn(() => Promise.resolve("first"));
        const mockFn2 = jest.fn(() => Promise.resolve("second"));
        const executionId = createExecutionId();

        operation.mockImplementation(mockFn1);
        operation.mockImplementationOnce(mockFn2);
        operation.registerMocks(executionId);

        expect(mockForExecution).toHaveBeenCalledTimes(2);
        expect(mockChain.onName).toHaveBeenCalledTimes(2);
        expect(mockChain.mock).toHaveBeenCalledWith(mockFn1, Infinity);
        expect(mockChain.mock).toHaveBeenCalledWith(mockFn2, 1);
      });

      it("should handle name-based mock with index", () => {
        const operation = new MockOperation(
          { name: "test-op", index: 3 },
          waitManager,
          mockIndexedOperations
        );
        const mockFn = jest.fn(() => Promise.resolve({}));
        const executionId = createExecutionId();

        operation.mockImplementation(mockFn);
        operation.registerMocks(executionId);

        expect(mockChain.onName).toHaveBeenCalledWith("test-op", 3);
        expect(mockChain.onIndex).not.toHaveBeenCalled();
      });
    });

    describe("method chaining", () => {
      it("should support chaining multiple mock methods", () => {
        const operation = new MockOperation({ name: "chain-op" }, waitManager, mockIndexedOperations);

        const result = operation
          .mockResolvedValue("first")
          .mockImplementationOnce(() => Promise.resolve("second"))
          .mockRejectedValue(new Error("error"));

        expect(result).toBe(operation);
        expect(operation.getMockCount()).toBe(3);
      });
    });

    describe("skipTime", () => {
      it("should throw 'Not implemented' error", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );

        expect(() => operation.skipTime()).toThrow("Not implemented");
      });
    });

    describe("testing helper methods", () => {
      it("should report correct mock counts", () => {
        const operation = new MockOperation(
          { name: "test-operation" },
          waitManager,
          mockIndexedOperations
        );

        expect(operation.getMockCount()).toBe(0);
        expect(operation.hasMocks()).toBe(false);
        expect(operation.getNameMockCount()).toBe(0);
        expect(operation.getIndexMockCount()).toBe(0);

        operation.mockResolvedValue("test");

        expect(operation.getMockCount()).toBe(1);
        expect(operation.hasMocks()).toBe(true);
        expect(operation.getNameMockCount()).toBe(1);
        expect(operation.getIndexMockCount()).toBe(0);
      });

      it("should distinguish between name and index mocks", () => {
        const nameOperation = new MockOperation(
          { name: "name-op" },
          waitManager,
          mockIndexedOperations
        );
        const indexOperation = new MockOperation({ index: 5 }, waitManager, mockIndexedOperations);

        nameOperation.mockResolvedValue("name");
        indexOperation.mockResolvedValue("index");

        expect(nameOperation.getNameMockCount()).toBe(1);
        expect(nameOperation.getIndexMockCount()).toBe(0);
        expect(indexOperation.getNameMockCount()).toBe(0);
        expect(indexOperation.getIndexMockCount()).toBe(1);
      });
    });
  });
});
