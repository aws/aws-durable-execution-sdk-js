import { DurablePromise } from "./durable-promise";

describe("DurablePromise", () => {
  it("should not execute until awaited", async () => {
    let executed = false;
    const promise = new DurablePromise(async () => {
      executed = true;
      return 42;
    });

    expect(executed).toBe(false);
    const result = await promise;
    expect(executed).toBe(true);
    expect(result).toBe(42);
  });

  it("should not execute until .then() is called", async () => {
    let executed = false;
    const promise = new DurablePromise(async () => {
      executed = true;
      return 42;
    });

    expect(executed).toBe(false);
    const result = await promise.then((v) => v * 2);
    expect(executed).toBe(true);
    expect(result).toBe(84);
  });

  it("should execute only once even with multiple .then() calls", async () => {
    let executionCount = 0;
    const promise = new DurablePromise(async () => {
      executionCount++;
      return 42;
    });

    const result1 = await promise.then((v) => v);
    const result2 = await promise.then((v) => v * 2);

    expect(executionCount).toBe(1);
    expect(result1).toBe(42);
    expect(result2).toBe(84);
  });

  it("should handle errors with .catch()", async () => {
    const promise = new DurablePromise(async () => {
      throw new Error("test error");
    });

    await expect(promise.catch((err) => (err as Error).message)).resolves.toBe(
      "test error",
    );
  });

  it("should work with Promise.race", async () => {
    let executed1 = false;
    let executed2 = false;

    const promise1 = new DurablePromise(async () => {
      executed1 = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "slow";
    });

    const promise2 = new DurablePromise(async () => {
      executed2 = true;
      return "fast";
    });

    expect(executed1).toBe(false);
    expect(executed2).toBe(false);

    const result = await Promise.race([promise1, promise2]);

    expect(result).toBe("fast");
    expect(executed1).toBe(true);
    expect(executed2).toBe(true);
  });

  it("should work with Promise.all", async () => {
    let executed1 = false;
    let executed2 = false;

    const promise1 = new DurablePromise(async () => {
      executed1 = true;
      return 1;
    });

    const promise2 = new DurablePromise(async () => {
      executed2 = true;
      return 2;
    });

    expect(executed1).toBe(false);
    expect(executed2).toBe(false);

    const result = await Promise.all([promise1, promise2]);

    expect(result).toEqual([1, 2]);
    expect(executed1).toBe(true);
    expect(executed2).toBe(true);
  });

  it("should support .finally()", async () => {
    let finallyCalled = false;
    const promise = new DurablePromise(async () => 42);

    const result = await promise.finally(() => {
      finallyCalled = true;
    });

    expect(result).toBe(42);
    expect(finallyCalled).toBe(true);
  });

  it("should handle undefined fn by creating a promise that never resolves", async () => {
    // Test with explicit undefined
    const promise1 = new DurablePromise(undefined);

    // Test with no parameter (implicitly undefined)
    const promise2 = new DurablePromise();

    // Use Promise.race to verify the promises don't resolve within a reasonable time
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve("timeout"), 50),
    );

    const result1 = await Promise.race([promise1, timeout]);
    const result2 = await Promise.race([promise2, timeout]);

    // Both should timeout, indicating the promises never resolved
    expect(result1).toBe("timeout");
    expect(result2).toBe("timeout");
  });
});
