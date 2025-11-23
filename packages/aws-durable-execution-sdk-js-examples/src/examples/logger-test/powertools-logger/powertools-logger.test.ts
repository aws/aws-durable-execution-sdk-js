import { handler } from "./powertools-logger";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import util from "node:util";

createTests({
  name: "powertools-logger",
  functionName: "powertools-logger",
  handler,
  tests: (runner, isCloud) => {
    if (isCloud) {
      it("should complete step operation successfully", async () => {
        const execution = await runner.run();
        expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
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

          // Parse captured log output as JSON objects from stdout and stderr separately
          const parseLogCalls = (calls: any[]) =>
            calls
              .map((call) => call[0] as string)
              .map((line) => JSON.parse(line));

          const stdoutLogs = parseLogCalls(stdoutSpy.mock.calls);
          const stderrLogs = parseLogCalls(stderrSpy.mock.calls);

          // Helper function to create expected log structure with correct field ordering
          const createPowertoolsLogExpectation = (
            level: string,
            message: unknown,
            hasoperation_id = false,
            attemptCount?: number,
            extra?: unknown,
            additionalKeys?: Record<string, unknown>,
          ) => {
            const expectation: Record<string, unknown> = {
              sampling_rate: 0,
              service: "powertools-logger",
              request_id: expect.any(String),
              timestamp: expect.any(String),
              level,
              execution_arn: expect.any(String),
              ...(hasoperation_id && {
                operation_id: expect.any(String),
              }),
              ...(attemptCount && {
                attempt: attemptCount,
              }),
              message: util.format(message),
              ...additionalKeys,
            };

            if (extra !== undefined) {
              expectation.extra = extra;
            }

            return expectation;
          };

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
            createPowertoolsLogExpectation(
              "DEBUG",
              "Step debug via log method",
              true,
              1,
            ),
            createPowertoolsLogExpectation(
              "INFO",
              "Step info via log method",
              true,
              1,
            ),
            createPowertoolsLogExpectation("INFO", "Before wait operation"),
            createPowertoolsLogExpectation(
              "INFO",
              "After wait operation - logger still works",
            ),
            createPowertoolsLogExpectation(
              "INFO",
              "User %s (ID: %d) completed operation",
              false,
              undefined,
              "TestUser",
              {
                "customMessage-1": "12345",
              },
            ),
            createPowertoolsLogExpectation(
              "INFO",
              "Info log from child context",
              true,
            ),
            createPowertoolsLogExpectation(
              "DEBUG",
              "Debug log from child context",
              true,
            ),
            createPowertoolsLogExpectation(
              "INFO",
              { stepData: "value", num: 42 },
              true,
              1,
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
              "Step warn via log method",
              true,
              1,
            ),
            createPowertoolsLogExpectation(
              "ERROR",
              "Step error via log method",
              true,
              1,
            ),
            createPowertoolsLogExpectation(
              "WARN",
              "Warning log from child context",
              true,
            ),
            // Error logging with message in context logger (error is formatted in message and details are attached)
            {
              request_id: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              execution_arn: expect.any(String),
              operation_id: expect.any(String),
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
              request_id: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              execution_arn: expect.any(String),
              message: "Error: Direct error logging\n    at handler.ts:123:45",
              sampling_rate: 0,
              service: "powertools-logger",
            },
            // Step error logging (single parameter with operation_id)
            {
              request_id: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              execution_arn: expect.any(String),
              operation_id: expect.any(String),
              message: expect.stringMatching(
                "Error: Step context direct error",
              ),
              attempt: 1,
              sampling_rate: 0,
              service: "powertools-logger",
            },
            // Multiple error logging in context
            {
              request_id: expect.any(String),
              timestamp: expect.any(String),
              level: "ERROR",
              execution_arn: expect.any(String),
              message: "Multiple errors in context:",
              error: {
                location: expect.any(String),
                message: "Second error",
                name: "Error",
                stack: expect.any(String),
              },
              sampling_rate: 0,
              service: "powertools-logger",
              extra: "additional data",
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
