import { ExecutionMockHandler } from "./execution-mock-handler";
import { MockCallback } from "./mock-callback-queue";

describe("ExecutionMockHandler", () => {
  let handler: ExecutionMockHandler;

  beforeEach(() => {
    handler = new ExecutionMockHandler();
  });

  describe("registerIndexMock", () => {
    it("should register index-based mock", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      handler.registerIndexMock(0, mockCallback, 1);

      const result = handler.recordOperation();
      expect(result).toBe(mockCallback);
    });
  });

  describe("registerNameMock", () => {
    it("should register name-based mock when index is undefined", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      handler.registerNameMock("testName", mockCallback, 1);

      const result = handler.recordOperation("testName");
      expect(result).toBe(mockCallback);
    });

    it("should register name+index-based mock when index is provided", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      handler.registerNameMock("testName", mockCallback, 1, 0);

      const result = handler.recordOperation("testName");
      expect(result).toBe(mockCallback);
    });
  });

  describe("executeOperation", () => {
    it("should return undefined when no mocks are registered", () => {
      const result = handler.recordOperation();
      expect(result).toBeUndefined();
    });

    it("should prioritize index-based mocks over name-based mocks", () => {
      const indexMock: MockCallback = jest.fn().mockResolvedValue("index");
      const nameMock: MockCallback = jest.fn().mockResolvedValue("name");

      handler.registerIndexMock(0, indexMock, 1);
      handler.registerNameMock("testName", nameMock, 1);

      const result = handler.recordOperation("testName");
      expect(result).toBe(indexMock);
    });

    it("should fall back to name-based mocks when no index mock exists", () => {
      const nameMock: MockCallback = jest.fn().mockResolvedValue("name");

      handler.registerNameMock("testName", nameMock, 1);

      const result = handler.recordOperation("testName");
      expect(result).toBe(nameMock);
    });

    it("should fall back to name+index-based mocks when no other mocks exist", () => {
      const nameIndexMock: MockCallback = jest
        .fn()
        .mockResolvedValue("nameIndex");

      handler.registerNameMock("testName", nameIndexMock, 1, 0);

      const result = handler.recordOperation("testName");
      expect(result).toBe(nameIndexMock);
    });

    it("should prioritize name-based over name+index-based mocks", () => {
      const nameMock: MockCallback = jest.fn().mockResolvedValue("name");
      const nameIndexMock: MockCallback = jest
        .fn()
        .mockResolvedValue("nameIndex");

      handler.registerNameMock("testName", nameMock, 1);
      handler.registerNameMock("testName", nameIndexMock, 1, 0);

      const result = handler.recordOperation("testName");
      expect(result).toBe(nameMock);
    });

    it("should increment global index on each call", () => {
      const mock1: MockCallback = jest.fn().mockResolvedValue("mock1");
      const mock2: MockCallback = jest.fn().mockResolvedValue("mock2");

      handler.registerIndexMock(0, mock1, 1);
      handler.registerIndexMock(1, mock2, 1);

      const result1 = handler.recordOperation();
      const result2 = handler.recordOperation();

      expect(result1).toBe(mock1);
      expect(result2).toBe(mock2);
    });

    it("should increment named index independently for each name", () => {
      const mock1: MockCallback = jest.fn().mockResolvedValue("mock1");
      const mock2: MockCallback = jest.fn().mockResolvedValue("mock2");
      const mock3: MockCallback = jest.fn().mockResolvedValue("mock3");

      handler.registerNameMock("name1", mock1, 1, 0);
      handler.registerNameMock("name1", mock2, 1, 1);
      handler.registerNameMock("name2", mock3, 1, 0);

      const result1 = handler.recordOperation("name1"); // name1, index 0
      const result2 = handler.recordOperation("name2"); // name2, index 0
      const result3 = handler.recordOperation("name1"); // name1, index 1

      expect(result1).toBe(mock1);
      expect(result2).toBe(mock3);
      expect(result3).toBe(mock2);
    });

    it("should handle operations without names", () => {
      const mock: MockCallback = jest.fn().mockResolvedValue("mock");

      handler.registerIndexMock(0, mock, 1);

      const result = handler.recordOperation();
      expect(result).toBe(mock);
    });

    it("should return undefined when name is provided but no name-based mocks exist", () => {
      const result = handler.recordOperation("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getMockCallback", () => {
    it("should behave the same as executeOperation", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      handler.registerNameMock("testName", mockCallback, 1);

      const executeResult = handler.recordOperation("testName");

      // Reset and test getMockCallback
      handler.registerNameMock("testName", mockCallback, 1);
      const getResult = handler.getMockCallback("testName");

      expect(executeResult).toBe(mockCallback);
      expect(getResult).toBe(mockCallback);
    });
  });

  describe("complex scenarios", () => {
    it("should handle all three mock types with correct priority", () => {
      const indexMock: MockCallback = jest.fn().mockResolvedValue("index");
      const nameMock: MockCallback = jest.fn().mockResolvedValue("name");
      const nameIndexMock: MockCallback = jest
        .fn()
        .mockResolvedValue("nameIndex");

      handler.registerIndexMock(0, indexMock, 1);
      handler.registerNameMock("testName", nameMock, 1);
      handler.registerNameMock("testName", nameIndexMock, 1, 2); // Register for nameIndex 2

      // First call should get index mock (highest priority)
      const result1 = handler.recordOperation("testName");
      expect(result1).toBe(indexMock);

      // Second call should get name mock (index 1, no index mock, but name mock exists)
      const result2 = handler.recordOperation("testName");
      expect(result2).toBe(nameMock);

      // Third call should get nameIndex mock (index 2, no index/name mocks left, fall back to nameIndex)
      const result3 = handler.recordOperation("testName");
      expect(result3).toBe(nameIndexMock);

      // Fourth call should return undefined
      const result4 = handler.recordOperation("testName");
      expect(result4).toBeUndefined();
    });

    it("should handle multiple counts correctly", () => {
      const mock: MockCallback = jest.fn().mockResolvedValue("test");

      handler.registerIndexMock(0, mock, 3);

      expect(handler.recordOperation()).toBe(mock);
      expect(handler.recordOperation()).toBeUndefined(); // index 1, no mock
      expect(handler.recordOperation()).toBeUndefined(); // index 2, no mock

      // Reset for same index with multiple counts
      handler.registerNameMock("test", mock, 2);

      expect(handler.recordOperation("test")).toBe(mock);
      expect(handler.recordOperation("test")).toBe(mock);
      expect(handler.recordOperation("test")).toBeUndefined();
    });
  });
});
