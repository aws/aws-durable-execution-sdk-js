import * as indexExports from "../index";
import * as localExports from "../local";
import * as cloudExports from "../cloud";
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

  it("should correctly re-export all exports from cloud", () => {
    // Get all exported keys from cloud
    const cloudKeys = Object.keys(cloudExports);

    // Check that all keys from cloud are in index exports
    for (const key of cloudKeys) {
      expect(Object.keys(indexExports)).toContain(key);
      expect((indexExports as Record<string, unknown>)[key]).toBe(
        (cloudExports as Record<string, unknown>)[key]
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
    const cloudKeys = Object.keys(cloudExports);

    // The total count of exports should match the sum of the individual modules
    expect(indexKeys.length).toBe(
      localKeys.length + durableKeys.length + cloudKeys.length
    );

    // Every key in indexExports should be in either localExports or durableTestRunnerExports
    for (const key of indexKeys) {
      const isInLocal = localKeys.includes(key);
      const isInDurable = durableKeys.includes(key);
      const isInCloud = cloudKeys.includes(key);
      expect(isInLocal || isInDurable || isInCloud).toBe(true);
    }
  });
});
