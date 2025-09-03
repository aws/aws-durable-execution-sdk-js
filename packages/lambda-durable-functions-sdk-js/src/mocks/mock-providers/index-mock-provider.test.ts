import { MockCallback } from "../mock-callback-queue";
import { IndexMockProvider } from "./index-mock-provider";

describe("IndexMockProvider", () => {
  let provider: IndexMockProvider;

  beforeEach(() => {
    provider = new IndexMockProvider();
  });

  describe("register", () => {
    it("should register mock callback for specific index", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register(1, mockCallback, 1);

      expect(provider.getMock(1)).toBe(mockCallback);
    });

    it("should handle multiple callbacks for same index", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register(1, mockCallback1, 1);
      provider.register(1, mockCallback2, 1);

      expect(provider.getMock(1)).toBe(mockCallback1);
      expect(provider.getMock(1)).toBe(mockCallback2);
      expect(provider.getMock(1)).toBeUndefined();
    });

    it("should handle callbacks with different counts", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register(1, mockCallback, 3);

      expect(provider.getMock(1)).toBe(mockCallback);
      expect(provider.getMock(1)).toBe(mockCallback);
      expect(provider.getMock(1)).toBe(mockCallback);
      expect(provider.getMock(1)).toBeUndefined();
    });

    it("should handle different indices independently", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register(1, mockCallback1, 1);
      provider.register(2, mockCallback2, 1);

      expect(provider.getMock(1)).toBe(mockCallback1);
      expect(provider.getMock(2)).toBe(mockCallback2);
      expect(provider.getMock(1)).toBeUndefined();
      expect(provider.getMock(2)).toBeUndefined();
    });
  });

  describe("getMock", () => {
    it("should return undefined for non-existent index", () => {
      expect(provider.getMock(999)).toBeUndefined();
    });

    it("should return undefined after all callbacks are consumed", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register(1, mockCallback, 1);
      provider.getMock(1);

      expect(provider.getMock(1)).toBeUndefined();
    });

    it("should handle zero index", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register(0, mockCallback, 1);

      expect(provider.getMock(0)).toBe(mockCallback);
    });

    it("should handle negative indices", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register(-1, mockCallback, 1);

      expect(provider.getMock(-1)).toBe(mockCallback);
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiple indices with different counts", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");
      const mockCallback3: MockCallback = jest.fn().mockResolvedValue("test3");

      provider.register(1, mockCallback1, 2);
      provider.register(2, mockCallback2, 1);
      provider.register(1, mockCallback3, 1);

      // Index 1: should get callback1 twice, then callback3 once
      expect(provider.getMock(1)).toBe(mockCallback1);
      expect(provider.getMock(1)).toBe(mockCallback1);
      expect(provider.getMock(1)).toBe(mockCallback3);
      expect(provider.getMock(1)).toBeUndefined();

      // Index 2: should get callback2 once
      expect(provider.getMock(2)).toBe(mockCallback2);
      expect(provider.getMock(2)).toBeUndefined();
    });
  });
});
