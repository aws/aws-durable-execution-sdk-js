import {
  SynchronousContextStorage,
  createContextStorage,
  isContextStorageDegraded,
  resetContextStorageDegradationForTesting,
  warnOnceIfContextStorageIsDegraded,
} from "./context-storage";

describe("context-storage", () => {
  afterEach(() => {
    resetContextStorageDegradationForTesting();
    jest.resetModules();
  });

  describe("createContextStorage", () => {
    it("uses the runtime's AsyncLocalStorage when available", async () => {
      const { AsyncLocalStorage } = await import("async_hooks");
      expect(createContextStorage()).toBeInstanceOf(AsyncLocalStorage);
      expect(isContextStorageDegraded()).toBe(false);
    });

    it("falls back and marks itself degraded when AsyncLocalStorage is absent", async () => {
      jest.doMock("async_hooks", () => ({}));

      const storage = await import("./context-storage");

      expect(storage.createContextStorage()).toBeInstanceOf(
        storage.SynchronousContextStorage,
      );
      expect(storage.isContextStorageDegraded()).toBe(true);
    });
  });

  describe("SynchronousContextStorage", () => {
    it("exposes the store for the synchronous portion of run", () => {
      const storage = new SynchronousContextStorage<string>();
      const observed = storage.run("a", () => storage.getStore());
      expect(observed).toBe("a");
    });

    it("restores the enclosing store when a nested run returns", () => {
      const storage = new SynchronousContextStorage<string>();
      storage.run("outer", () => {
        storage.run("inner", () => {
          expect(storage.getStore()).toBe("inner");
        });
        expect(storage.getStore()).toBe("outer");
      });
      expect(storage.getStore()).toBeUndefined();
    });

    it("reports no store once the callback suspends, rather than a stale one", async () => {
      const storage = new SynchronousContextStorage<string>();
      let afterAwait: string | undefined = "unset";
      const pending = storage.run("a", async () => {
        await Promise.resolve();
        afterAwait = storage.getStore();
      });
      // `run` has already returned by the time the callback suspends.
      expect(storage.getStore()).toBeUndefined();
      await pending;
      // A stale "a" here would make validateContextUsage fail correct executions; the
      // contract is "unknown", not "last seen".
      expect(afterAwait).toBeUndefined();
    });

    it("restores the previous store when the callback throws", () => {
      const storage = new SynchronousContextStorage<string>();
      storage.run("outer", () => {
        expect(() =>
          storage.run("inner", () => {
            throw new Error("boom");
          }),
        ).toThrow("boom");
        expect(storage.getStore()).toBe("outer");
      });
    });

    it("returns the callback's value", () => {
      const storage = new SynchronousContextStorage<number>();
      expect(storage.run(1, () => "value")).toBe("value");
    });
  });

  describe("warnOnceIfContextStorageIsDegraded", () => {
    it("stays quiet when the runtime provides AsyncLocalStorage", () => {
      const logger = { warn: jest.fn() };
      createContextStorage();
      warnOnceIfContextStorageIsDegraded(logger);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("warns exactly once per process when degraded", async () => {
      jest.doMock("async_hooks", () => ({}));

      const storage = await import("./context-storage");
      const logger = { warn: jest.fn() };

      storage.createContextStorage();
      storage.warnOnceIfContextStorageIsDegraded(logger);
      storage.warnOnceIfContextStorageIsDegraded(logger);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain("AsyncLocalStorage");
      expect(logger.warn.mock.calls[0][0]).toContain(
        "Checkpointing and replay are unaffected",
      );
    });
  });
});
