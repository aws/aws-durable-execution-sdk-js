import { handler } from "./powertools-logger";
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
          // The adapter adds the durable metadata with the same camelCase key
          // names as the SDK's default logger.
          const createPowertoolsLogExpectation = (
            level: string,
            message: unknown,
            operationName?: string,
            attemptCount?: number,
            additionalKeys?: Record<string, unknown>,
          ) => ({
            sampling_rate: 0,
            service: "powertools-logger",
            requestId: expect.any(String),
            timestamp: expect.any(String),
            level,
            executionArn: expect.any(String),
            ...(operationName !== undefined && {
              operationId: expect.any(String),
              operationName,
            }),
            ...(attemptCount !== undefined && {
              attempt: attemptCount,
            }),
            message: util.format(message),
            ...additionalKeys,
          });

          // Expected stdout logs (INFO and DEBUG levels)
          const expectedStdoutLogs = [
            createPowertoolsLogExpectation(
              "INFO",
              "=== Logger Level Demo Starting ===",
            ),
            createPowertoolsLogExpectation(
              "DEBUG",
              "Debug message: Detailed debugging information",
            ),
            createPowertoolsLogExpectation(
              "INFO",
              "Info message: General information about execution",
            ),
            createPowertoolsLogExpectation("INFO", "Before wait operation"),
            createPowertoolsLogExpectation(
              "INFO",
              "After wait operation - logger still works",
            ),
            createPowertoolsLogExpectation(
              "INFO",
              "Info log from child context",
              "child-context",
            ),
            createPowertoolsLogExpectation(
              "DEBUG",
              "Debug log from child context",
              "child-context",
            ),
            createPowertoolsLogExpectation(
              "INFO",
              "message",
              "direct-object-step",
              1,
              { stepData: "value", num: 42 },
            ),
          ];

          // Expected stderr logs (WARN and ERROR levels)
          const expectedStderrLogs = [
            createPowertoolsLogExpectation(
              "WARN",
              "Warning message: Something might need attention",
            ),
            createPowertoolsLogExpectation(
              "ERROR",
              "Error message: Something went wrong (simulated)",
            ),
            createPowertoolsLogExpectation(
              "WARN",
              "Warning log from child context",
              "child-context",
            ),
            // Error logging with message in context logger (error is formatted in message and details are attached)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              operationId: expect.any(String),
              operationName: "child-context",
              message: "Error from child context with Error object:",
              error: {
                location: expect.any(String),
                message: "Child context error",
                name: "Error",
                stack: expect.any(String),
              },
              sampling_rate: 0,
              service: "powertools-logger",
            },
            // Direct error logging (single parameter - Error becomes structured message)
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              message: "message",
              sampling_rate: 0,
              error: {
                location: expect.any(String),
                message: "Step context direct error",
                name: "Error",
                stack: expect.any(String),
              },
              attempt: 1,
              operationId: expect.any(String),
              operationName: "direct-object-step",
              service: "powertools-logger",
            },
            // Multiple error logging in context
            {
              requestId: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              executionArn: expect.any(String),
              message: "Errors in context:",
              error: {
                location: expect.any(String),
                message: "First error",
                name: "Error",
                stack: expect.any(String),
              },
              sampling_rate: 0,
              service: "powertools-logger",
            },
          ];

          // Assert exact structure and order for each stream
          expect(stdoutLogs).toStrictEqual(expectedStdoutLogs);
          expect(stderrLogs).toStrictEqual(expectedStderrLogs);
        } finally {
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();
        }
      });
    }
  },
});
