import { OperationInterceptor } from "./operation-interceptor";
import { MockCallback } from "./mock-callback-queue";

describe("OperationInterceptor", () => {
  beforeEach(() => {
    OperationInterceptor.clearAll();
  });

  describe("clearAll", () => {
    it("should clear all mock handlers", () => {
      const mocker = OperationInterceptor.forExecution("test-exec");
      mocker.onIndex(0).mock(jest.fn().mockResolvedValue("test"));

      expect(mocker.recordOnly(undefined)).toBe(true);

      OperationInterceptor.clearAll();

      // After clearing, should need to re-register
      expect(mocker.recordOnly(undefined)).toBe(false);
    });
  });

  describe("ExecutionMocker", () => {
    let mocker: ReturnType<typeof OperationInterceptor.forExecution>;

    beforeEach(() => {
      mocker = OperationInterceptor.forExecution("test-exec");
    });

    describe("onIndex", () => {
      it("should register index-based mock", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onIndex(0).mock(mockCallback);

        expect(mocker.recordOnly(undefined)).toBe(true);
      });

      it("should handle multiple registrations for same index", () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("test1");
        const mock2: MockCallback = jest.fn().mockResolvedValue("test2");

        mocker.onIndex(0).mock(mock1);
        mocker.onIndex(0).mock(mock2);

        expect(mocker.recordOnly(undefined)).toBe(true);
        expect(mocker.recordOnly(undefined)).toBe(false); // index 1, no mock
      });

      it("should handle count parameter", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onIndex(0).mock(mockCallback, 3);

        expect(mocker.recordOnly(undefined)).toBe(true);
        expect(mocker.recordOnly(undefined)).toBe(false); // index 1, no mock
        expect(mocker.recordOnly(undefined)).toBe(false); // index 2, no mock
      });
    });

    describe("onName", () => {
      it("should register name-based mock", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onName("testOp").mock(mockCallback);

        expect(mocker.recordOnly("testOp")).toBe(true);
      });

      it("should register name+index-based mock", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onName("testOp", 0).mock(mockCallback);

        expect(mocker.recordOnly("testOp")).toBe(true);
      });

      it("should handle multiple counts", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onName("testOp").mock(mockCallback, 3);

        expect(mocker.recordOnly("testOp")).toBe(true);
        expect(mocker.recordOnly("testOp")).toBe(true);
        expect(mocker.recordOnly("testOp")).toBe(true);
        expect(mocker.recordOnly("testOp")).toBe(false);
      });
    });

    describe("run", () => {
      it("should call original function when no mock is registered", async () => {
        const originalFn = jest.fn().mockResolvedValue("original");

        const result = await mocker.execute("testOp", originalFn);

        expect(result).toBe("original");
        expect(originalFn).toHaveBeenCalled();
      });

      it("should call mock callback when registered", async () => {
        const mockCallback: MockCallback = jest
          .fn()
          .mockResolvedValue("mocked");
        const originalFn = jest.fn().mockResolvedValue("original");

        mocker.onName("testOp").mock(mockCallback);

        const result = await mocker.execute("testOp", originalFn);

        expect(result).toBe("mocked");
        expect(originalFn).not.toHaveBeenCalled();
        expect(mockCallback).toHaveBeenCalled();
      });

      it("should handle index-based mocks", async () => {
        const mockCallback: MockCallback = jest
          .fn()
          .mockResolvedValue("mocked");
        const originalFn = jest.fn().mockResolvedValue("original");

        mocker.onIndex(0).mock(mockCallback);

        const result = await mocker.execute(undefined, originalFn);

        expect(result).toBe("mocked");
        expect(originalFn).not.toHaveBeenCalled();
      });

      it("should handle type casting correctly", async () => {
        interface CustomType {
          value: string;
        }

        const mockCallback: MockCallback = jest
          .fn()
          .mockResolvedValue({ value: "mocked" });
        const originalFn = jest.fn().mockResolvedValue({ value: "original" });

        mocker.onName("testOp").mock(mockCallback);

        const result = await mocker.execute<CustomType>("testOp", originalFn);

        expect(result).toEqual({ value: "mocked" });
        expect(typeof result).toBe("object");
      });
    });

    describe("recordOnly", () => {
      it("should return false when no mock is registered", () => {
        const result = mocker.recordOnly("testOp");
        expect(result).toBe(false);
      });

      it("should return true when mock is registered", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onName("testOp").mock(mockCallback);

        const result = mocker.recordOnly("testOp");
        expect(result).toBe(true);
      });

      it("should handle named operations", () => {
        const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

        mocker.onName("testOp").mock(mockCallback);

        const result = mocker.recordOnly("testOp");
        expect(result).toBe(true);
      });
    });

    describe("integration scenarios", () => {
      it("should handle complex mock priority scenarios", async () => {
        const indexMock: MockCallback = jest.fn().mockResolvedValue("index");
        const nameMock: MockCallback = jest.fn().mockResolvedValue("name");
        const nameIndexMock: MockCallback = jest
          .fn()
          .mockResolvedValue("nameIndex");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register all types of mocks
        mocker.onIndex(0).mock(indexMock, 1);
        mocker.onName("testOp").mock(nameMock, 1);
        mocker.onName("testOp", 2).mock(nameIndexMock, 1); // Register for nameIndex 2

        // Index mock should have highest priority
        const result1 = await mocker.execute("testOp", originalFn);
        expect(result1).toBe("index");

        // Name mock should be next
        const result2 = await mocker.execute("testOp", originalFn);
        expect(result2).toBe("name");

        // Name+index mock should be last
        const result3 = await mocker.execute("testOp", originalFn);
        expect(result3).toBe("nameIndex");

        // Should fall back to original function
        const result4 = await mocker.execute("testOp", originalFn);
        expect(result4).toBe("original");
        expect(originalFn).toHaveBeenCalledTimes(1);
      });

      it("should handle multiple execution contexts independently", async () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("exec1");
        const mock2: MockCallback = jest.fn().mockResolvedValue("exec2");
        const originalFn = jest.fn().mockResolvedValue("original");

        const mocker1 = OperationInterceptor.forExecution("exec-1");
        const mocker2 = OperationInterceptor.forExecution("exec-2");

        mocker1.onName("testOp").mock(mock1);
        mocker2.onName("testOp").mock(mock2);

        const result1 = await mocker1.execute("testOp", originalFn);
        const result2 = await mocker2.execute("testOp", originalFn);

        expect(result1).toBe("exec1");
        expect(result2).toBe("exec2");
        expect(originalFn).not.toHaveBeenCalled();
      });
    });

    describe("mock chaining", () => {
      it("should handle chain of count=1 mocks followed by Infinity mock", async () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("first");
        const mock2: MockCallback = jest.fn().mockResolvedValue("second");
        const mock3: MockCallback = jest.fn().mockResolvedValue("third");
        const mockInfinite: MockCallback = jest
          .fn()
          .mockResolvedValue("infinite");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register chain: 3 finite mocks followed by Infinity mock
        mocker.onName("testOp").mock(mock1, 1);
        mocker.onName("testOp").mock(mock2, 1);
        mocker.onName("testOp").mock(mock3, 1);
        mocker.onName("testOp").mock(mockInfinite, Infinity);

        // First three calls should use finite mocks
        const result1 = await mocker.execute("testOp", originalFn);
        expect(result1).toBe("first");

        const result2 = await mocker.execute("testOp", originalFn);
        expect(result2).toBe("second");

        const result3 = await mocker.execute("testOp", originalFn);
        expect(result3).toBe("third");

        // All subsequent calls should use Infinity mock
        const result4 = await mocker.execute("testOp", originalFn);
        expect(result4).toBe("infinite");

        const result5 = await mocker.execute("testOp", originalFn);
        expect(result5).toBe("infinite");

        const result6 = await mocker.execute("testOp", originalFn);
        expect(result6).toBe("infinite");

        // Original function should never be called
        expect(originalFn).not.toHaveBeenCalled();
      });

      it("should handle multiple Infinity mocks - last registered wins", async () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("infinity1");
        const mock2: MockCallback = jest.fn().mockResolvedValue("infinity2");
        const mock3: MockCallback = jest.fn().mockResolvedValue("infinity3");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register multiple Infinity mocks
        mocker.onName("testOp").mock(mock1, Infinity);
        mocker.onName("testOp").mock(mock2, Infinity);
        mocker.onName("testOp").mock(mock3, Infinity);

        // Should only use the last registered Infinity mock
        const result1 = await mocker.execute("testOp", originalFn);
        expect(result1).toBe("infinity3");

        const result2 = await mocker.execute("testOp", originalFn);
        expect(result2).toBe("infinity3");

        const result3 = await mocker.execute("testOp", originalFn);
        expect(result3).toBe("infinity3");

        expect(originalFn).not.toHaveBeenCalled();
      });

      it("should handle mixed count patterns", async () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("two-count");
        const mock2: MockCallback = jest.fn().mockResolvedValue("one-count");
        const mock3: MockCallback = jest.fn().mockResolvedValue("three-count");
        const mockDefault: MockCallback = jest
          .fn()
          .mockResolvedValue("default");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register complex pattern: 2, 1, 3, Infinity
        mocker.onName("testOp").mock(mock1, 2);
        mocker.onName("testOp").mock(mock2, 1);
        mocker.onName("testOp").mock(mock3, 3);
        mocker.onName("testOp").mock(mockDefault, Infinity);

        // Calls 1-2: two-count mock
        expect(await mocker.execute("testOp", originalFn)).toBe("two-count");
        expect(await mocker.execute("testOp", originalFn)).toBe("two-count");

        // Call 3: one-count mock
        expect(await mocker.execute("testOp", originalFn)).toBe("one-count");

        // Calls 4-6: three-count mock
        expect(await mocker.execute("testOp", originalFn)).toBe("three-count");
        expect(await mocker.execute("testOp", originalFn)).toBe("three-count");
        expect(await mocker.execute("testOp", originalFn)).toBe("three-count");

        // Calls 7+: Infinity mock
        expect(await mocker.execute("testOp", originalFn)).toBe("default");
        expect(await mocker.execute("testOp", originalFn)).toBe("default");
        expect(await mocker.execute("testOp", originalFn)).toBe("default");

        expect(originalFn).not.toHaveBeenCalled();
      });

      it("should handle index-based chaining", async () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("first");
        const mock2: MockCallback = jest.fn().mockResolvedValue("second");
        const mock3: MockCallback = jest.fn().mockResolvedValue("third");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register index-based chain - each call increments global index
        // Register specific mocks for specific indices
        mocker.onIndex(0).mock(mock1, 1); // For global index 0
        mocker.onIndex(1).mock(mock2, 1); // For global index 1
        mocker.onIndex(2).mock(mock3, 1); // For global index 2

        // Test the chain
        expect(await mocker.execute(undefined, originalFn)).toBe("first"); // globalIndex=0
        expect(await mocker.execute(undefined, originalFn)).toBe("second"); // globalIndex=1
        expect(await mocker.execute(undefined, originalFn)).toBe("third"); // globalIndex=2

        // After registered mocks exhausted, should fall back to original
        expect(await mocker.execute(undefined, originalFn)).toBe("original"); // globalIndex=3
        expect(originalFn).toHaveBeenCalledTimes(1);
      });

      it("should handle cross-strategy chaining (index + name)", async () => {
        const indexMock1: MockCallback = jest.fn().mockResolvedValue("index1");
        const indexMock2: MockCallback = jest.fn().mockResolvedValue("index2");
        const nameMock1: MockCallback = jest.fn().mockResolvedValue("name1");
        const nameMock2: MockCallback = jest.fn().mockResolvedValue("name2");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register both index and name mocks - index mocks for different global indices
        mocker.onIndex(0).mock(indexMock1, 1); // globalIndex=0
        mocker.onIndex(1).mock(indexMock2, 1); // globalIndex=1
        mocker.onName("testOp").mock(nameMock1, 1);
        mocker.onName("testOp").mock(nameMock2, Infinity);

        // Index mocks should have priority over name mocks
        expect(await mocker.execute("testOp", originalFn)).toBe("index1"); // globalIndex=0
        expect(await mocker.execute("testOp", originalFn)).toBe("index2"); // globalIndex=1

        // After index mocks exhausted, should use name mocks
        expect(await mocker.execute("testOp", originalFn)).toBe("name1"); // globalIndex=2, no index mock
        expect(await mocker.execute("testOp", originalFn)).toBe("name2"); // globalIndex=3, no index mock
        expect(await mocker.execute("testOp", originalFn)).toBe("name2"); // globalIndex=4, no index mock

        expect(originalFn).not.toHaveBeenCalled();
      });

      it("should handle finite mocks preventing Infinity mock clearing", async () => {
        const infinityMock1: MockCallback = jest
          .fn()
          .mockResolvedValue("infinity1");
        const finiteMock: MockCallback = jest.fn().mockResolvedValue("finite");
        const infinityMock2: MockCallback = jest
          .fn()
          .mockResolvedValue("infinity2");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Start with Infinity mock
        mocker.onName("testOp").mock(infinityMock1, Infinity);

        // Add finite mock - prevents clearing
        mocker.onName("testOp").mock(finiteMock, 2);

        // Add another Infinity mock - should not clear first one due to finite mock
        mocker.onName("testOp").mock(infinityMock2, Infinity);

        // Should process infinity1 first (until finite mock count is consumed)
        expect(await mocker.execute("testOp", originalFn)).toBe("infinity1");
        expect(await mocker.execute("testOp", originalFn)).toBe("infinity1");
        expect(await mocker.execute("testOp", originalFn)).toBe("infinity1");

        expect(originalFn).not.toHaveBeenCalled();
      });

      it("should handle complex chaining with recordOnly", () => {
        const mock1: MockCallback = jest.fn().mockResolvedValue("first");
        const mock2: MockCallback = jest.fn().mockResolvedValue("second");
        const mockInfinite: MockCallback = jest
          .fn()
          .mockResolvedValue("infinite");

        // Register chained mocks
        mocker.onName("testOp").mock(mock1, 1);
        mocker.onName("testOp").mock(mock2, 2);
        mocker.onName("testOp").mock(mockInfinite, Infinity);

        // recordOnly should indicate mock is available throughout the chain
        expect(mocker.recordOnly("testOp")).toBe(true); // Consumes mock1
        expect(mocker.recordOnly("testOp")).toBe(true); // First mock2
        expect(mocker.recordOnly("testOp")).toBe(true); // Second mock2
        expect(mocker.recordOnly("testOp")).toBe(true); // First infinite
        expect(mocker.recordOnly("testOp")).toBe(true); // Second infinite
        expect(mocker.recordOnly("testOp")).toBe(true); // Still infinite
      });

      it("should handle name+index chaining within same strategy", async () => {
        const nameIndexMock1: MockCallback = jest
          .fn()
          .mockResolvedValue("nameIndex1");
        const nameIndexMock2: MockCallback = jest
          .fn()
          .mockResolvedValue("nameIndex2");
        const nameMock: MockCallback = jest.fn().mockResolvedValue("name");
        const originalFn = jest.fn().mockResolvedValue("original");

        // Register name+index mocks and plain name mock
        // Priority: Name > Name+Index, so name mock will be used first
        mocker.onName("testOp", 0).mock(nameIndexMock1, 1); // nameIndex=0
        mocker.onName("testOp", 1).mock(nameIndexMock2, 1); // nameIndex=1
        mocker.onName("testOp").mock(nameMock, 1); // Higher priority than name+index

        // Name mock should have higher priority than name+index mocks
        expect(await mocker.execute("testOp", originalFn)).toBe("name"); // nameIndex=0, uses name mock

        // After name mock exhausted, should use name+index mocks
        expect(await mocker.execute("testOp", originalFn)).toBe("nameIndex2"); // nameIndex=1, uses nameIndex2

        // After all mocks exhausted, should fall back to original
        expect(await mocker.execute("testOp", originalFn)).toBe("original"); // nameIndex=2, no more mocks

        expect(originalFn).toHaveBeenCalledTimes(1);
      });
    });
  });
});
