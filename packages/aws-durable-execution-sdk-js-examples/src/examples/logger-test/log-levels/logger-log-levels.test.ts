import { handler } from "./logger-log-levels";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import util from "node:util";

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    if (isCloud) {
      it("should complete step operation successfully", async () => {
        const execution = await runner.run();
        expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
        assertEventSignatures(execution);
      });
    } else {
      it("should execute successfully with all log levels", async () => {
        // Spy on process stdout and stderr to capture log output
        const stdoutSpy = jest
          .spyOn(process.stdout, "write")
          .mockImplementation();
        const stderrSpy = jest
          .spyOn(process.stderr, "write")
          .mockImplementation();

        try {
          const execution = await runner.run();

          expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

          assertEventSignatures(execution);

          // Parse captured log output as JSON objects from stdout and stderr separately
          const parseLogCalls = (calls: any[]) =>
            calls
              .map((call) => call[0] as string)
              .map((line) => JSON.parse(line));

          const stdoutLogs = parseLogCalls(stdoutSpy.mock.calls);
          const stderrLogs = parseLogCalls(stderrSpy.mock.calls);

          // Helper function to create expected log structure with correct field ordering
          const createLogExpectation = (
            level: string,
            message: unknown,
            hasOperationId = false,
            attemptCount?: number,
          ) => ({
            requestId: expect.any(String),
            timestamp: expect.any(String),
            level,
            executionArn: expect.any(String),
            ...(hasOperationId && {
              operationId: expect.any(String),
            }),
            ...(attemptCount && {
              attempt: attemptCount,
            }),
            message,
          });

          // Expected stdout logs (INFO and DEBUG levels)
          const expectedStdoutLogs = [
            createLogExpectation("INFO", "=== Logger Level Demo Starting ==="),
            createLogExpectation(
              "DEBUG",
              "Debug message: Detailed debugging information",
            ),
            createLogExpectation(
              "INFO",
              "Info message: General information about execution",
            ),
            createLogExpectation("DEBUG", "Step debug via log method", true, 1),
            createLogExpectation("INFO", "Step info via log method", true, 1),
            createLogExpectation(
              "INFO",
              "Logging with object: { key: 'value', nested: { prop: 'test' }, array: [ 1, 2, 3 ] }",
            ),
            createLogExpectation(
              "DEBUG",
              "Debug with multiple params: param1 42 true { key: 'value', nested: { prop: 'test' }, array: [ 1, 2, 3 ] }",
            ),
            createLogExpectation("INFO", "Before wait operation"),
            createLogExpectation(
              "INFO",
              "After wait operation - logger still works",
            ),
            createLogExpectation(
              "INFO",
              "User TestUser (ID: 12345) completed operation",
            ),
            createLogExpectation("INFO", "Info log from step context", true, 1),
            createLogExpectation(
              "DEBUG",
              "Debug log from step context",
              true,
              1,
            ),
            createLogExpectation("INFO", "Info log from child context", true),
            createLogExpectation("DEBUG", "Debug log from child context", true),
            createLogExpectation(
              "INFO",
              `Complex object test: ${util.format({ user: { id: 123, name: "John" }, settings: { theme: "dark", notifications: true }, data: [1, 2, { nested: "value" }] })}`,
            ),
            createLogExpectation(
              "INFO",
              "Circular object test: <ref *1> { name: 'circular', self: [Circular *1] }",
            ),
            // Direct object logging (single parameter - object becomes message)
            createLogExpectation("INFO", {
              direct: "object",
              test: true,
            }),
            // Step object logging (single parameter with operationId)
            createLogExpectation(
              "INFO",
              { stepData: "value", num: 42 },
              true,
              1,
            ),
            // Retry step logs - attempt 1
            createLogExpectation("INFO", "Executing retry step", true, 1),
            // Retry step logs - attempt 2
            createLogExpectation("INFO", "Executing retry step", true, 2),
            // Retry step logs - attempt 3
            createLogExpectation("INFO", "Executing retry step", true, 3),
            // Retry step logs - attempt 4 (final success)
            createLogExpectation("INFO", "Executing retry step", true, 4),
            createLogExpectation("INFO", "=== Logger Level Demo Complete ==="),
          ];

          // Expected stderr logs (WARN and ERROR levels)
          const expectedStderrLogs = [
            createLogExpectation(
              "WARN",
              "Warning message: Something might need attention",
            ),
            createLogExpectation(
              "ERROR",
              "Error message: Something went wrong (simulated)",
            ),
            createLogExpectation("WARN", "Step warn via log method", true, 1),
            createLogExpectation("ERROR", "Step error via log method", true, 1),
            createLogExpectation(
              "WARN",
              "Warning log from step context",
              true,
              1,
            ),
            createLogExpectation(
              "ERROR",
              "Error log from step context",
              true,
              1,
            ),
            createLogExpectation(
              "WARN",
              "Warning log from child context",
              true,
            ),
            // Error logging with message in context logger (error is formatted in message and details are attached)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              operationId: expect.any(String),
              message: expect.stringMatching(
                /^Error from child context with Error object: Error: Child context error/,
              ),
              errorMessage: "Child context error",
              errorType: "Error",
              stackTrace: expect.any(Array),
            },
            // Error logging with message (error is formatted in message and details are attached)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              message:
                "Testing error object serialization: Error: Structured error test\n    at handler.ts:1:1",
              errorMessage: "Structured error test",
              errorType: "Error",
              stackTrace: expect.any(Array),
            },
            // Direct error logging (single parameter - Error becomes structured message)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              message: {
                errorType: "Error",
                errorMessage: "Direct error logging",
                stackTrace: [
                  "Error: Direct error logging",
                  "    at handler.ts:123:45",
                ],
              },
            },
            // Step error logging (single parameter with operationId)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              operationId: expect.any(String),
              message: {
                errorType: "Error",
                errorMessage: "Step context direct error",
                stackTrace: expect.any(Array),
              },
              attempt: 1,
            },
            // Multiple error logging in context (first error extracted to fields)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              message: expect.stringMatching(
                /^Multiple errors in context: Error: First error/,
              ),
              errorType: "Error",
              errorMessage: "First error",
              stackTrace: expect.any(Array),
            },
            // Multiple error logging in step context (first error extracted to fields)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              operationId: expect.any(String),
              message: expect.stringMatching(
                /^Multiple errors in step: Error: First step error/,
              ),
              errorType: "Error",
              errorMessage: "First step error",
              stackTrace: expect.any(Array),
              attempt: 1,
            },
            // Retry step WARN logs - attempt 1
            createLogExpectation(
              "WARN",
              "This step will fail on first 3 attempts",
              true,
              1,
            ),
            // Retry step WARN logs - attempt 2
            createLogExpectation(
              "WARN",
              "This step will fail on first 3 attempts",
              true,
              2,
            ),
            // Retry step WARN logs - attempt 3
            createLogExpectation(
              "WARN",
              "This step will fail on first 3 attempts",
              true,
              3,
            ),
            // Retry step WARN logs - attempt 4 (final)
            createLogExpectation(
              "WARN",
              "This step will fail on first 3 attempts",
              true,
              4,
            ),
          ];

          // Assert exact structure and order for each stream
          expect(stdoutLogs).toStrictEqual(expectedStdoutLogs);
          expect(stderrLogs).toStrictEqual(expectedStderrLogs);
        } finally {
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();
        }
      });

      it("should respect AWS_LAMBDA_LOG_LEVEL=INFO and disable DEBUG logs", async () => {
        const originalEnv = process.env.AWS_LAMBDA_LOG_LEVEL;
        process.env.AWS_LAMBDA_LOG_LEVEL = "INFO";

        const stdoutSpy = jest
          .spyOn(process.stdout, "write")
          .mockImplementation();
        const stderrSpy = jest
          .spyOn(process.stderr, "write")
          .mockImplementation();

        try {
          const execution = await runner.run();
          expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

          const parseLogCalls = (calls: any[]) =>
            calls
              .map((call) => call[0] as string)
              .map((line) => JSON.parse(line));

          const stdoutLogs = parseLogCalls(stdoutSpy.mock.calls);
          const stderrLogs = parseLogCalls(stderrSpy.mock.calls);

          // Should have no DEBUG logs in stdout
          const debugLogs = stdoutLogs.filter((log) => log.level === "DEBUG");
          expect(debugLogs).toEqual([]);

          // Should still have INFO logs
          const infoLogs = stdoutLogs.filter((log) => log.level === "INFO");
          expect(infoLogs.length).toBeGreaterThan(0);

          // Should still have WARN/ERROR logs in stderr
          const warnLogs = stderrLogs.filter((log) => log.level === "WARN");
          const errorLogs = stderrLogs.filter((log) => log.level === "ERROR");
          expect(warnLogs.length).toBeGreaterThan(0);
          expect(errorLogs.length).toBeGreaterThan(0);
        } finally {
          if (originalEnv !== undefined) {
            process.env.AWS_LAMBDA_LOG_LEVEL = originalEnv;
          } else {
            delete process.env.AWS_LAMBDA_LOG_LEVEL;
          }
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();
        }
      });

      it("should respect AWS_LAMBDA_LOG_LEVEL=WARN and disable DEBUG/INFO logs", async () => {
        const originalEnv = process.env.AWS_LAMBDA_LOG_LEVEL;
        process.env.AWS_LAMBDA_LOG_LEVEL = "WARN";

        const stdoutSpy = jest
          .spyOn(process.stdout, "write")
          .mockImplementation();
        const stderrSpy = jest
          .spyOn(process.stderr, "write")
          .mockImplementation();

        try {
          const execution = await runner.run();
          expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

          const parseLogCalls = (calls: any[]) =>
            calls
              .map((call) => call[0] as string)
              .map((line) => line.trim())
              .filter((line) => line.startsWith("{"))
              .map((line) => JSON.parse(line));

          const stdoutLogs = parseLogCalls(stdoutSpy.mock.calls);
          const stderrLogs = parseLogCalls(stderrSpy.mock.calls);

          // Should have no DEBUG or INFO logs in stdout
          expect(stdoutLogs).toEqual([]);

          // Should still have WARN/ERROR logs in stderr
          const warnLogs = stderrLogs.filter((log) => log.level === "WARN");
          const errorLogs = stderrLogs.filter((log) => log.level === "ERROR");
          expect(warnLogs.length).toBeGreaterThan(0);
          expect(errorLogs.length).toBeGreaterThan(0);
        } finally {
          if (originalEnv !== undefined) {
            process.env.AWS_LAMBDA_LOG_LEVEL = originalEnv;
          } else {
            delete process.env.AWS_LAMBDA_LOG_LEVEL;
          }
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();
        }
      });

      it("should respect AWS_LAMBDA_LOG_LEVEL=ERROR and disable DEBUG/INFO/WARN logs", async () => {
        const originalEnv = process.env.AWS_LAMBDA_LOG_LEVEL;
        process.env.AWS_LAMBDA_LOG_LEVEL = "ERROR";

        const stdoutSpy = jest
          .spyOn(process.stdout, "write")
          .mockImplementation();
        const stderrSpy = jest
          .spyOn(process.stderr, "write")
          .mockImplementation();

        try {
          const execution = await runner.run();
          expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

          const parseLogCalls = (calls: any[]) =>
            calls
              .map((call) => call[0] as string)
              .map((line) => line.trim())
              .filter((line) => line.startsWith("{"))
              .map((line) => JSON.parse(line));

          const stdoutLogs = parseLogCalls(stdoutSpy.mock.calls);
          const stderrLogs = parseLogCalls(stderrSpy.mock.calls);

          // Should have no DEBUG or INFO logs in stdout
          expect(stdoutLogs).toEqual([]);

          // Should have no WARN logs in stderr, only ERROR logs
          const warnLogs = stderrLogs.filter((log) => log.level === "WARN");
          const errorLogs = stderrLogs.filter((log) => log.level === "ERROR");
          expect(warnLogs).toEqual([]);
          expect(errorLogs.length).toBeGreaterThan(0);
        } finally {
          if (originalEnv !== undefined) {
            process.env.AWS_LAMBDA_LOG_LEVEL = originalEnv;
          } else {
            delete process.env.AWS_LAMBDA_LOG_LEVEL;
          }
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();
        }
      });
    }
  },
});
