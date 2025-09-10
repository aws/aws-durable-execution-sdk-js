import { MockCallback } from "../mock-callback-queue";
import { NameIndexMockProvider } from "./name-index-mock-provider";

describe("NameIndexMockProvider", () => {
  let provider: NameIndexMockProvider;

  beforeEach(() => {
    provider = new NameIndexMockProvider();
  });

  describe("register", () => {
    it("should register mock callback for specific name and index", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", 0, mockCallback, 1);

      expect(provider.getMock("testName", 0)).toBe(mockCallback);
    });

    it("should handle multiple callbacks for same name and index", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register("testName", 0, mockCallback1, 1);
      provider.register("testName", 0, mockCallback2, 1);

      expect(provider.getMock("testName", 0)).toBe(mockCallback1);
      expect(provider.getMock("testName", 0)).toBe(mockCallback2);
      expect(provider.getMock("testName", 0)).toBeUndefined();
    });

    it("should handle callbacks with different counts", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", 0, mockCallback, 3);

      expect(provider.getMock("testName", 0)).toBe(mockCallback);
      expect(provider.getMock("testName", 0)).toBe(mockCallback);
      expect(provider.getMock("testName", 0)).toBe(mockCallback);
      expect(provider.getMock("testName", 0)).toBeUndefined();
    });

    it("should handle different names independently", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register("name1", 0, mockCallback1, 1);
      provider.register("name2", 0, mockCallback2, 1);

      expect(provider.getMock("name1", 0)).toBe(mockCallback1);
      expect(provider.getMock("name2", 0)).toBe(mockCallback2);
      expect(provider.getMock("name1", 0)).toBeUndefined();
      expect(provider.getMock("name2", 0)).toBeUndefined();
    });

    it("should handle different indices for same name independently", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register("testName", 0, mockCallback1, 1);
      provider.register("testName", 1, mockCallback2, 1);

      expect(provider.getMock("testName", 0)).toBe(mockCallback1);
      expect(provider.getMock("testName", 1)).toBe(mockCallback2);
      expect(provider.getMock("testName", 0)).toBeUndefined();
      expect(provider.getMock("testName", 1)).toBeUndefined();
    });

    it("should handle large indices", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", 999999, mockCallback, 1);

      expect(provider.getMock("testName", 999999)).toBe(mockCallback);
    });
  });

  describe("getMock", () => {
    it("should return undefined for non-existent name", () => {
      expect(provider.getMock("nonexistent", 0)).toBeUndefined();
    });

    it("should return undefined for non-existent index", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", 0, mockCallback, 1);

      expect(provider.getMock("testName", 1)).toBeUndefined();
    });

    it("should return undefined after all callbacks are consumed", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", 0, mockCallback, 1);
      provider.getMock("testName", 0);

      expect(provider.getMock("testName", 0)).toBeUndefined();
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiple names and indices with different counts", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");
      const mockCallback3: MockCallback = jest.fn().mockResolvedValue("test3");
      const mockCallback4: MockCallback = jest.fn().mockResolvedValue("test4");

      provider.register("name1", 0, mockCallback1, 2);
      provider.register("name1", 1, mockCallback2, 1);
      provider.register("name2", 0, mockCallback3, 1);
      provider.register("name1", 0, mockCallback4, 1);

      // name1, index 0: should get callback1 twice, then callback4 once
      expect(provider.getMock("name1", 0)).toBe(mockCallback1);
      expect(provider.getMock("name1", 0)).toBe(mockCallback1);
      expect(provider.getMock("name1", 0)).toBe(mockCallback4);
      expect(provider.getMock("name1", 0)).toBeUndefined();

      // name1, index 1: should get callback2 once
      expect(provider.getMock("name1", 1)).toBe(mockCallback2);
      expect(provider.getMock("name1", 1)).toBeUndefined();

      // name2, index 0: should get callback3 once
      expect(provider.getMock("name2", 0)).toBe(mockCallback3);
      expect(provider.getMock("name2", 0)).toBeUndefined();
    });

    it("should handle empty string names", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("", 0, mockCallback, 1);

      expect(provider.getMock("", 0)).toBe(mockCallback);
    });
  });
});
