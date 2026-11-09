import path from "node:path";
import { defineConfig } from "vitest/config";

// One config for every mode of this package:
//   npm test                        local runner tests (default)
//   NODE_ENV=integration            cloud tests only, against real Lambda
//   SDK_COVERAGE=true --coverage    local tests with coverage of the SDK source
//                                   copied into src/dur-sdk (see SDK_COVERAGE.md)
const isIntegration = process.env.NODE_ENV === "integration";
const isSdkCoverage = process.env.SDK_COVERAGE === "true";

export default defineConfig({
  resolve: {
    alias: isSdkCoverage
      ? {
          "@aws/durable-execution-sdk-js": path.resolve(
            __dirname,
            "src/dur-sdk/index.ts",
          ),
        }
      : {},
  },
  test: {
    // The tests use describe/it/expect/beforeAll without importing them.
    globals: true,
    include: isIntegration
      ? ["src/examples/**/*.test.ts"]
      : [
          "src/__tests__/**/*.test.ts",
          "src/examples/**/*.test.ts",
          "src/esm-examples/**/*.test.ts",
          "scripts/__tests__/**/*.test.ts",
        ],
    setupFiles: ["./vitest.setup.ts"],
    // With the default `forks` pool, about 1 run in 4 never finished: every
    // file had reported, but the main process and one idle child waited on
    // each other forever (a CI job hit the 1h timeout). Worker threads have
    // no child process IPC, and 16 runs in a row finished in ~21s.
    pool: "threads",
    ...(isIntegration
      ? {
          // Each integration test spends most of its time waiting on Lambda,
          // not on the CPU. A CPU-bound worker count is far too low. On the
          // 4-CPU CI runner 3 files at a time took about 276 s, and 16 workers
          // took about 58 s. With 24 workers the Lambda API returned
          // TooManyRequestsException and bail stopped the run. So do not raise
          // this without checking throttling. Other AWS accounts can have lower
          // quotas than the CI account, so the override applies only in CI and
          // local runs keep the default.
          testTimeout: 120000,
          testNamePattern: "cloud",
          bail: 1,
          ...(process.env.CI ? { maxWorkers: 16 } : {}),
        }
      : {
          // These tests run examples in the local runner. On the 4-CPU CI
          // runner the suite was not CPU-bound, and 12 workers was the fastest
          // setting. The override applies only in CI, and local runs keep the
          // default.
          ...(process.env.CI ? { maxWorkers: 12 } : {}),
        }),
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage-sdk",
      reporter: ["cobertura", "html", "text"],
      // Jest wrote the report even when a test failed. Keep that behavior.
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/dur-sdk/run-durable.ts", "**/*.test.ts", "**/*.d.ts"],
    },
  },
});
