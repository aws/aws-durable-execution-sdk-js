import { MockRegistry } from "./mock-registry";
import { ExecutionMockHandler } from "./execution-mock-handler";

describe("MockRegistry", () => {
  let registry: MockRegistry;

  beforeEach(() => {
    // Reset singleton instance before each test
    registry = new MockRegistry();
  });

  afterEach(() => {
    registry.clearAll();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = MockRegistry.getInstance();
      const instance2 = MockRegistry.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(MockRegistry);
    });
  });

  describe("getHandler", () => {
    it("should create new handler for new execution ID", () => {
      const handler = registry.getHandler("execution-1");

      expect(handler).toBeInstanceOf(ExecutionMockHandler);
    });

    it("should return same handler for same execution ID", () => {
      const handler1 = registry.getHandler("execution-1");
      const handler2 = registry.getHandler("execution-1");

      expect(handler1).toBe(handler2);
    });

    it("should return different handlers for different execution IDs", () => {
      const handler1 = registry.getHandler("execution-1");
      const handler2 = registry.getHandler("execution-2");

      expect(handler1).not.toBe(handler2);
      expect(handler1).toBeInstanceOf(ExecutionMockHandler);
      expect(handler2).toBeInstanceOf(ExecutionMockHandler);
    });

    it("should handle empty string as execution ID", () => {
      const handler = registry.getHandler("");

      expect(handler).toBeInstanceOf(ExecutionMockHandler);
    });
  });

  describe("clearAll", () => {
    it("should remove all handlers", () => {
      const handler1 = registry.getHandler("execution-1");
      const handler2 = registry.getHandler("execution-2");
      const handler3 = registry.getHandler("execution-3");

      registry.clearAll();

      // Getting handlers again should create new instances
      const newHandler1 = registry.getHandler("execution-1");
      const newHandler2 = registry.getHandler("execution-2");
      const newHandler3 = registry.getHandler("execution-3");

      expect(newHandler1).not.toBe(handler1);
      expect(newHandler2).not.toBe(handler2);
      expect(newHandler3).not.toBe(handler3);
    });

    it("should handle clearAll when no handlers exist", () => {
      expect(() => registry.clearAll()).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should maintain separate handler states", () => {
      const handler1 = registry.getHandler("execution-1");
      const handler2 = registry.getHandler("execution-2");

      // Register mocks on different handlers
      handler1.registerIndexMock(0, jest.fn().mockResolvedValue("exec1"), 1);
      handler2.registerIndexMock(0, jest.fn().mockResolvedValue("exec2"), 1);

      // Each handler should return its own mock
      const result1 = handler1.recordOperation();
      const result2 = handler2.recordOperation();

      expect(result1).not.toBe(result2);
    });

    it("should handle concurrent access to same execution ID", () => {
      const handler1 = registry.getHandler("execution-1");
      const handler2 = registry.getHandler("execution-1");

      expect(handler1).toBe(handler2);
    });

    it("should maintain state after multiple operations", () => {
      const handler = registry.getHandler("execution-1");
      const mockCallback = jest.fn().mockResolvedValue("test");

      handler.registerIndexMock(0, mockCallback, 2);

      expect(handler.recordOperation()).toBe(mockCallback);
      expect(handler.recordOperation()).toBeUndefined(); // index 2, no mock

      // Handler should maintain its state
      expect(registry.getHandler("execution-1")).toBe(handler);
    });
  });
});
