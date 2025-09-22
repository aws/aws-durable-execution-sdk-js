import * as indexExports from "../index";
import * as localDurableTestRunnerExports from "../local-durable-test-runner";

describe("test-runner/local/index.ts exports", () => {
  it("should correctly re-export all exports from local-durable-test-runner", () => {
    // Get all exported keys from local-durable-test-runner
    const durableRunnerKeys = Object.keys(localDurableTestRunnerExports);

    // Get all exported keys from index
    const indexKeys = Object.keys(indexExports);

    // Check that all keys from local-durable-test-runner are in index exports
    for (const key of durableRunnerKeys) {
      expect(indexKeys).toContain(key);
      expect((indexExports as Record<string, unknown>)[key]).toBe(
        (localDurableTestRunnerExports as Record<string, unknown>)[key]
      );
    }

    // Check that index doesn't export anything not in local-durable-test-runner
    expect(indexKeys.length).toBe(durableRunnerKeys.length);
  });

  it("should export the LocalDurableTestRunner class", () => {
    expect(indexExports).toHaveProperty("LocalDurableTestRunner");
    expect(typeof indexExports.LocalDurableTestRunner).toBe("function");
  });
});
