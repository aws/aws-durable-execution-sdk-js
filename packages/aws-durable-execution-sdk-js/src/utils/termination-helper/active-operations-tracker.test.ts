import {
  ActiveOperationsTracker,
  trackOperation,
} from "./active-operations-tracker";

describe("ActiveOperationsTracker", () => {
  let tracker: ActiveOperationsTracker;

  beforeEach(() => {
    tracker = new ActiveOperationsTracker();
  });

  describe("basic operations", () => {
    it("should start with zero active operations", () => {
      expect(tracker.hasActive()).toBe(false);
      expect(tracker.getCount()).toBe(0);
    });

    it("should increment and decrement correctly", () => {
      tracker.increment();
      expect(tracker.hasActive()).toBe(true);
      expect(tracker.getCount()).toBe(1);

      tracker.increment();
      expect(tracker.getCount()).toBe(2);

      tracker.decrement();
      expect(tracker.getCount()).toBe(1);

      tracker.decrement();
      expect(tracker.hasActive()).toBe(false);
      expect(tracker.getCount()).toBe(0);
    });

    it("should not go below zero", () => {
      tracker.decrement();
      tracker.decrement();
      expect(tracker.getCount()).toBe(0);
    });

    it("should reset to zero", () => {
      tracker.increment();
      tracker.increment();
      tracker.reset();
      expect(tracker.getCount()).toBe(0);
      expect(tracker.hasActive()).toBe(false);
    });
  });

  describe("trackOperation", () => {
    it("should track successful async operation", async () => {
      const operation = async (): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "success";
      };

      expect(tracker.hasActive()).toBe(false);

      const promise = trackOperation(tracker, operation);
      expect(tracker.hasActive()).toBe(true);
      expect(tracker.getCount()).toBe(1);

      const result = await promise;
      expect(result).toBe("success");
      expect(tracker.hasActive()).toBe(false);
      expect(tracker.getCount()).toBe(0);
    });

    it("should track failed async operation", async () => {
      const operation = async (): Promise<never> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("operation failed");
      };

      expect(tracker.hasActive()).toBe(false);

      const promise = trackOperation(tracker, operation);
      expect(tracker.hasActive()).toBe(true);

      await expect(promise).rejects.toThrow("operation failed");
      expect(tracker.hasActive()).toBe(false);
      expect(tracker.getCount()).toBe(0);
    });

    it("should track multiple concurrent operations", async () => {
      const operation1 = async (): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "op1";
      };

      const operation2 = async (): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "op2";
      };

      const promise1 = trackOperation(tracker, operation1);
      const promise2 = trackOperation(tracker, operation2);

      expect(tracker.getCount()).toBe(2);

      await promise2;
      expect(tracker.getCount()).toBe(1);

      await promise1;
      expect(tracker.getCount()).toBe(0);
    });
  });
});
