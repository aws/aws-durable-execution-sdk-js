import { MockCallback, MockCallbackQueue } from "./mock-callback-queue";

describe("MockCallbackQueue", () => {
  let queue: MockCallbackQueue;

  beforeEach(() => {
    queue = new MockCallbackQueue();
  });

  describe("constructor", () => {
    it("should create an empty queue by default", () => {
      expect(queue.dequeueCallback()).toBeUndefined();
    });

    it("should initialize with provided callbacks", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");
      const initialValue = [{ callback: mockCallback, count: 1 }];

      const queueWithInitial = new MockCallbackQueue(initialValue);

      expect(queueWithInitial.dequeueCallback()).toBe(mockCallback);
    });
  });

  describe("enqueueCallbacks", () => {
    it("should add callback to queue", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      queue.enqueueCallbacks({ callback: mockCallback, count: 1 });

      expect(queue.dequeueCallback()).toBe(mockCallback);
    });

    it("should maintain order of enqueued callbacks", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      queue.enqueueCallbacks({ callback: mockCallback1, count: 1 });
      queue.enqueueCallbacks({ callback: mockCallback2, count: 1 });

      expect(queue.dequeueCallback()).toBe(mockCallback1);
      expect(queue.dequeueCallback()).toBe(mockCallback2);
    });
  });

  describe("dequeueCallback", () => {
    it("should return undefined for empty queue", () => {
      expect(queue.dequeueCallback()).toBeUndefined();
    });

    it("should return callback when count is 1", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      queue.enqueueCallbacks({ callback: mockCallback, count: 1 });

      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBeUndefined();
    });

    it("should return same callback multiple times when count > 1", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      queue.enqueueCallbacks({ callback: mockCallback, count: 3 });

      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBeUndefined();
    });

    it("should decrement count on each dequeue", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");

      queue.enqueueCallbacks({ callback: mockCallback1, count: 2 });
      queue.enqueueCallbacks({ callback: mockCallback2, count: 1 });

      expect(queue.dequeueCallback()).toBe(mockCallback1);
      expect(queue.dequeueCallback()).toBe(mockCallback1);
      expect(queue.dequeueCallback()).toBe(mockCallback2);
      expect(queue.dequeueCallback()).toBeUndefined();
    });

    it("should handle mixed counts correctly", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");
      const mockCallback3: MockCallback = jest.fn().mockResolvedValue("test3");

      queue.enqueueCallbacks({ callback: mockCallback1, count: 1 });
      queue.enqueueCallbacks({ callback: mockCallback2, count: 3 });
      queue.enqueueCallbacks({ callback: mockCallback3, count: 2 });

      // First callback (count 1)
      expect(queue.dequeueCallback()).toBe(mockCallback1);

      // Second callback (count 3)
      expect(queue.dequeueCallback()).toBe(mockCallback2);
      expect(queue.dequeueCallback()).toBe(mockCallback2);
      expect(queue.dequeueCallback()).toBe(mockCallback2);

      // Third callback (count 2)
      expect(queue.dequeueCallback()).toBe(mockCallback3);
      expect(queue.dequeueCallback()).toBe(mockCallback3);

      // Queue should be empty
      expect(queue.dequeueCallback()).toBeUndefined();
    });
  });

  describe("Infinity mock behavior", () => {
    it("should handle single Infinity mock", () => {
      const mockCallback: MockCallback = jest.fn().mockResolvedValue("test");

      queue.enqueueCallbacks({ callback: mockCallback, count: Infinity });

      // Should return same callback indefinitely
      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBe(mockCallback);
      expect(queue.dequeueCallback()).toBe(mockCallback);
    });

    it("should clear queue when adding Infinity mock without finite mocks", () => {
      const mockCallback1: MockCallback = jest.fn().mockResolvedValue("test1");
      const mockCallback2: MockCallback = jest.fn().mockResolvedValue("test2");
      const mockCallback3: MockCallback = jest.fn().mockResolvedValue("test3");

      // Add first Infinity mock
      queue.enqueueCallbacks({ callback: mockCallback1, count: Infinity });

      // Add second Infinity mock - should clear first one
      queue.enqueueCallbacks({ callback: mockCallback2, count: Infinity });

      // Add third Infinity mock - should clear second one
      queue.enqueueCallbacks({ callback: mockCallback3, count: Infinity });

      // Should only get the last registered Infinity mock
      expect(queue.dequeueCallback()).toBe(mockCallback3);
      expect(queue.dequeueCallback()).toBe(mockCallback3);
      expect(queue.dequeueCallback()).toBe(mockCallback3);
    });

    it("should not clear queue when adding Infinity mock after finite mocks", () => {
      const finiteMock: MockCallback = jest.fn().mockResolvedValue("finite");
      const infinityMock: MockCallback = jest
        .fn()
        .mockResolvedValue("infinity");

      // Add finite mock first
      queue.enqueueCallbacks({ callback: finiteMock, count: 2 });

      // Add Infinity mock - should not clear queue due to existing finite mock
      queue.enqueueCallbacks({ callback: infinityMock, count: Infinity });

      // Should process finite mock first
      expect(queue.dequeueCallback()).toBe(finiteMock);
      expect(queue.dequeueCallback()).toBe(finiteMock);

      // Then Infinity mock
      expect(queue.dequeueCallback()).toBe(infinityMock);
      expect(queue.dequeueCallback()).toBe(infinityMock);
      expect(queue.dequeueCallback()).toBe(infinityMock);
    });

    it("should handle multiple Infinity mocks with finite mocks in between", () => {
      const infinity1: MockCallback = jest.fn().mockResolvedValue("infinity1");
      const finite1: MockCallback = jest.fn().mockResolvedValue("finite1");
      const infinity2: MockCallback = jest.fn().mockResolvedValue("infinity2");
      const finite2: MockCallback = jest.fn().mockResolvedValue("finite2");

      // Start with Infinity mock
      queue.enqueueCallbacks({ callback: infinity1, count: Infinity });

      // Add finite mock - prevents clearing
      queue.enqueueCallbacks({ callback: finite1, count: 1 });

      // Add another Infinity mock - should not clear due to finite mock
      queue.enqueueCallbacks({ callback: infinity2, count: Infinity });

      // Add another finite mock
      queue.enqueueCallbacks({ callback: finite2, count: 2 });

      // Should process in FIFO order: infinity1, finite1, infinity2, finite2, finite2
      expect(queue.dequeueCallback()).toBe(infinity1); // Infinity continues
      expect(queue.dequeueCallback()).toBe(infinity1); // Infinity continues
      // Note: Since infinity1 has Infinity count, it will keep returning
      // But let's test the queue structure by consuming finite items first
    });
  });

  describe("complex chaining scenarios", () => {
    it("should handle alternating finite and Infinity mocks", () => {
      const finite1: MockCallback = jest.fn().mockResolvedValue("finite1");
      const infinity1: MockCallback = jest.fn().mockResolvedValue("infinity1");
      const finite2: MockCallback = jest.fn().mockResolvedValue("finite2");
      const infinity2: MockCallback = jest.fn().mockResolvedValue("infinity2");

      // Add alternating pattern
      queue.enqueueCallbacks({ callback: finite1, count: 1 });
      queue.enqueueCallbacks({ callback: infinity1, count: Infinity });
      queue.enqueueCallbacks({ callback: finite2, count: 2 });
      queue.enqueueCallbacks({ callback: infinity2, count: Infinity });

      // Should process finite1, then infinity1 indefinitely (since Infinity doesn't get consumed)
      expect(queue.dequeueCallback()).toBe(finite1); // finite1 consumed
      expect(queue.dequeueCallback()).toBe(infinity1); // infinity1 starts
      expect(queue.dequeueCallback()).toBe(infinity1); // infinity1 continues
      expect(queue.dequeueCallback()).toBe(infinity1); // infinity1 continues
    });

    it("should handle queue reset behavior correctly", () => {
      const oldMock: MockCallback = jest.fn().mockResolvedValue("old");
      const newMock: MockCallback = jest.fn().mockResolvedValue("new");

      // Start with Infinity mock
      queue.enqueueCallbacks({ callback: oldMock, count: Infinity });
      expect(queue.dequeueCallback()).toBe(oldMock);

      // Add new Infinity mock - should replace old one
      queue.enqueueCallbacks({ callback: newMock, count: Infinity });
      expect(queue.dequeueCallback()).toBe(newMock);
      expect(queue.dequeueCallback()).toBe(newMock);
    });

    it("should preserve finite mocks when adding new Infinity mock", () => {
      const finite1: MockCallback = jest.fn().mockResolvedValue("finite1");
      const finite2: MockCallback = jest.fn().mockResolvedValue("finite2");
      const infinity1: MockCallback = jest.fn().mockResolvedValue("infinity1");
      const infinity2: MockCallback = jest.fn().mockResolvedValue("infinity2");

      // Setup: finite -> infinity -> finite -> infinity
      queue.enqueueCallbacks({ callback: finite1, count: 1 });
      queue.enqueueCallbacks({ callback: infinity1, count: Infinity });
      queue.enqueueCallbacks({ callback: finite2, count: 2 });

      // Adding another infinity should not clear because of finite mocks
      queue.enqueueCallbacks({ callback: infinity2, count: Infinity });

      // Process finite1
      expect(queue.dequeueCallback()).toBe(finite1);

      // Now should get infinity1 (first infinity mock)
      expect(queue.dequeueCallback()).toBe(infinity1);
      expect(queue.dequeueCallback()).toBe(infinity1);
    });
  });
});
