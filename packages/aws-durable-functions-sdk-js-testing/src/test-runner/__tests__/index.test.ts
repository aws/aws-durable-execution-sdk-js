import * as indexExports from "../index";
import * as localExports from "../local";
import * as durableTestRunnerExports from "../durable-test-runner";

describe("test-runner/index.ts exports", () => {
  it("should correctly re-export all exports from local", () => {
    // Get all exported keys from local
    const localKeys = Object.keys(localExports);

    // Check that all keys from local are in index exports
    for (const key of localKeys) {
      expect(Object.keys(indexExports)).toContain(key);
      expect((indexExports as Record<string, unknown>)[key]).toBe(
        (localExports as Record<string, unknown>)[key]
      );
    }
  });

  it("should correctly re-export all exports from durable-test-runner", () => {
    // Get all exported keys from durable-test-runner
    const durableKeys = Object.keys(durableTestRunnerExports);

    // Check that all keys from durable-test-runner are in index exports
    for (const key of durableKeys) {
      expect(Object.keys(indexExports)).toContain(key);
      expect((indexExports as Record<string, unknown>)[key]).toBe(
        (durableTestRunnerExports as Record<string, unknown>)[key]
      );
    }
  });

  it("should only export items from local and durable-test-runner", () => {
    // Get all exported keys
    const indexKeys = Object.keys(indexExports);
    const localKeys = Object.keys(localExports);
    const durableKeys = Object.keys(durableTestRunnerExports);

    // The total count of exports should match the sum of the individual modules
    expect(indexKeys.length).toBe(localKeys.length + durableKeys.length);

    // Every key in indexExports should be in either localExports or durableTestRunnerExports
    for (const key of indexKeys) {
      const isInLocal = localKeys.includes(key);
      const isInDurable = durableKeys.includes(key);
      expect(isInLocal || isInDurable).toBe(true);
    }
  });
});
