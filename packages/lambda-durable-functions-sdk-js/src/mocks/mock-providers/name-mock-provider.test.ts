import { MockCallback } from "../mock-callback-queue";
import { NameMockProvider } from "./name-mock-provider";

describe("NameMockProvider", () => {
  let provider: NameMockProvider;

  beforeEach(() => {
    provider = new NameMockProvider();
  });

  describe("register", () => {
    it("should register mock callback for specific name", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", mockCallback, 1);

      expect(provider.getMock("testName")).toBe(mockCallback);
    });

    it("should handle multiple callbacks for same name", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register("testName", mockCallback1, 1);
      provider.register("testName", mockCallback2, 1);

      expect(provider.getMock("testName")).toBe(mockCallback1);
      expect(provider.getMock("testName")).toBe(mockCallback2);
      expect(provider.getMock("testName")).toBeUndefined();
    });

    it("should handle callbacks with different counts", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", mockCallback, 3);

      expect(provider.getMock("testName")).toBe(mockCallback);
      expect(provider.getMock("testName")).toBe(mockCallback);
      expect(provider.getMock("testName")).toBe(mockCallback);
      expect(provider.getMock("testName")).toBeUndefined();
    });

    it("should handle different names independently", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      provider.register("name1", mockCallback1, 1);
      provider.register("name2", mockCallback2, 1);

      expect(provider.getMock("name1")).toBe(mockCallback1);
      expect(provider.getMock("name2")).toBe(mockCallback2);
      expect(provider.getMock("name1")).toBeUndefined();
      expect(provider.getMock("name2")).toBeUndefined();
    });

    it("should handle empty string as valid name", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("", mockCallback, 1);

      expect(provider.getMock("")).toBe(mockCallback);
    });
  });

  describe("getMock", () => {
    it("should return undefined for non-existent name", () => {
      expect(provider.getMock("nonexistent")).toBeUndefined();
    });

    it("should return undefined after all callbacks are consumed", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      provider.register("testName", mockCallback, 1);
      provider.getMock("testName");

      expect(provider.getMock("testName")).toBeUndefined();
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiple names with different counts", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");
      const mockCallback3: MockCallback = jest.fn().mockResolvedValue("test3");

      provider.register("name1", mockCallback1, 2);
      provider.register("name2", mockCallback2, 1);
      provider.register("name1", mockCallback3, 1);

      // name1: should get callback1 twice, then callback3 once
      expect(provider.getMock("name1")).toBe(mockCallback1);
      expect(provider.getMock("name1")).toBe(mockCallback1);
      expect(provider.getMock("name1")).toBe(mockCallback3);
      expect(provider.getMock("name1")).toBeUndefined();

      // name2: should get callback2 once
      expect(provider.getMock("name2")).toBe(mockCallback2);
      expect(provider.getMock("name2")).toBeUndefined();
    });
  });
});
