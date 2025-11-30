import { DurablePromise } from "./durable-promise";

describe("DurablePromise Simplified Implementation", () => {
  it("should generate unique handler ID by default", () => {
    const promise1 = new DurablePromise(async () => "test1");
    const promise2 = new DurablePromise(async () => "test2");

    expect(promise1.handlerId).toMatch(/^handler-\d+-[a-z0-9]+$/);
    expect(promise2.handlerId).toMatch(/^handler-\d+-[a-z0-9]+$/);
    expect(promise1.handlerId).not.toBe(promise2.handlerId);
  });

  it("should use custom handlerId when provided", () => {
    const customId = "custom-handler-123";
    const promise = new DurablePromise(async () => "test", customId);

    expect(promise.handlerId).toBe(customId);
  });

  it("should maintain deferred execution behavior", async () => {
    let executed = false;
    const promise = new DurablePromise(async () => {
      executed = true;
      return "test result";
    });

    // Should not execute immediately
    expect(executed).toBe(false);
    expect(promise.isExecuted).toBe(false);

    // Should execute when awaited
    const result = await promise;
    expect(executed).toBe(true);
    expect(promise.isExecuted).toBe(true);
    expect(result).toBe("test result");
  });

  it("should work with then/catch/finally", async () => {
    const promise = new DurablePromise(async () => "test");

    const result = await promise
      .then((value) => value.toUpperCase())
      .catch(() => "error")
      .finally(() => {});

    expect(result).toBe("TEST");
  });

  it("should handle promise rejection", async () => {
    const error = new Error("test error");
    const promise = new DurablePromise(async () => {
      throw error;
    });

    await expect(promise).rejects.toThrow("test error");
  });

  it("should maintain handler ID through promise chains", async () => {
    const handlerId = "test-handler";
    const promise = new DurablePromise(async () => "test", handlerId);

    expect(promise.handlerId).toBe(handlerId);

    // Handler ID should remain accessible even after execution
    await promise;
    expect(promise.handlerId).toBe(handlerId);
  });

  it("should support promise resolver pattern for centralized management", async () => {
    const handlerId = "wait-handler-123";
    let capturedResolver: ((value: void) => void) | undefined;

    const promise = new DurablePromise(async () => {
      return new Promise<void>((resolve) => {
        // This simulates giving control to checkpoint manager
        capturedResolver = resolve;
      });
    }, handlerId);

    expect(promise.handlerId).toBe(handlerId);

    // Start the promise (but don't await yet)
    const resultPromise = promise;

    // Simulate checkpoint manager resolving the promise later
    setTimeout(() => {
      capturedResolver?.();
    }, 10);

    // Should resolve when checkpoint manager decides
    await expect(resultPromise).resolves.toBeUndefined();
  });
});
