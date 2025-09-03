import { OperationTracker } from "./operation-tracker";

describe("OperationTracker", () => {
  let tracker: OperationTracker;

  beforeEach(() => {
    tracker = new OperationTracker();
  });

  describe("incrementGlobal", () => {
    it("should start at 1 and increment", () => {
      expect(tracker.incrementGlobal()).toBe(0);
      expect(tracker.incrementGlobal()).toBe(1);
      expect(tracker.incrementGlobal()).toBe(2);
    });

    it("should be independent of named operations", () => {
      tracker.incrementNamed("test");
      expect(tracker.incrementGlobal()).toBe(0);

      tracker.incrementNamed("another");
      expect(tracker.incrementGlobal()).toBe(1);
    });
  });

  describe("incrementNamed", () => {
    it("should start at 0 for new names", () => {
      expect(tracker.incrementNamed("test")).toBe(0);
      expect(tracker.incrementNamed("another")).toBe(0);
    });

    it("should increment independently for each name", () => {
      expect(tracker.incrementNamed("test")).toBe(0);
      expect(tracker.incrementNamed("test")).toBe(1);
      expect(tracker.incrementNamed("test")).toBe(2);

      expect(tracker.incrementNamed("another")).toBe(0);
      expect(tracker.incrementNamed("another")).toBe(1);

      expect(tracker.incrementNamed("test")).toBe(3);
    });

    it("should be independent of global operations", () => {
      tracker.incrementGlobal();
      tracker.incrementGlobal();

      expect(tracker.incrementNamed("test")).toBe(0);
      expect(tracker.incrementNamed("test")).toBe(1);
    });
  });

  describe("getCurrentGlobal", () => {
    it("should return 0 initially", () => {
      expect(tracker.getCurrentGlobal()).toBe(0);
    });

    it("should return current global index without incrementing", () => {
      tracker.incrementGlobal();
      tracker.incrementGlobal();

      expect(tracker.getCurrentGlobal()).toBe(2);
      expect(tracker.getCurrentGlobal()).toBe(2); // Should not increment
    });
  });

  describe("getCurrentNamed", () => {
    it("should return -1 for non-existent names", () => {
      expect(tracker.getCurrentNamed("nonexistent")).toBe(-1);
    });

    it("should return current named index without incrementing", () => {
      tracker.incrementNamed("test");
      tracker.incrementNamed("test");

      expect(tracker.getCurrentNamed("test")).toBe(1);
      expect(tracker.getCurrentNamed("test")).toBe(1); // Should not increment
    });

    it("should return correct values for different names", () => {
      tracker.incrementNamed("first");
      tracker.incrementNamed("first");
      tracker.incrementNamed("second");

      expect(tracker.getCurrentNamed("first")).toBe(1);
      expect(tracker.getCurrentNamed("second")).toBe(0);
      expect(tracker.getCurrentNamed("nonexistent")).toBe(-1);
    });
  });

  describe("combined operations", () => {
    it("should handle mixed global and named operations correctly", () => {
      // Mix of operations
      expect(tracker.incrementGlobal()).toBe(0);
      expect(tracker.incrementNamed("test")).toBe(0);
      expect(tracker.incrementGlobal()).toBe(1);
      expect(tracker.incrementNamed("test")).toBe(1);
      expect(tracker.incrementNamed("another")).toBe(0);
      expect(tracker.incrementGlobal()).toBe(2);

      // Check current states
      expect(tracker.getCurrentGlobal()).toBe(3);
      expect(tracker.getCurrentNamed("test")).toBe(1);
      expect(tracker.getCurrentNamed("another")).toBe(0);
    });
  });
});
