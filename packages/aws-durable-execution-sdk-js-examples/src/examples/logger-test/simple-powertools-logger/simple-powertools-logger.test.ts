import { handler } from "./simple-powertools-logger";
import historyEvents from "./simple-powertools-logger.history.json";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  name: "simple-powertools-logger",
  functionName: "simple-powertools-logger",
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    if (isCloud) {
      it("should complete step operation successfully", async () => {
        const execution = await runner.run();
        expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
        expect(execution.getResult()).toBe(
          "Simple logger example completed successfully",
        );
        assertEventSignatures(execution.getHistoryEvents(), historyEvents);
      });
    } else {
      it("should execute successfully with simple logger (no DurableLogger interface)", async () => {
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
          expect(execution.getResult()).toBe(
            "Simple logger example completed successfully",
          );

          assertEventSignatures(execution.getHistoryEvents(), historyEvents);

          // Parse captured log output as JSON objects from stdout and stderr separately
          const parseLogCalls = (calls: any[]) =>
            calls
              .map((call) => call[0] as string)
              .map((line) => JSON.parse(line));

          const stdoutLogs = parseLogCalls(stdoutSpy.mock.calls);
          const stderrLogs = parseLogCalls(stderrSpy.mock.calls);

          // Expected stdout logs (INFO and DEBUG levels)
          // These logs don't contain durable execution metadata since the logger
          // doesn't implement configureDurableLoggingContext
          const expectedStdoutLogs = [
            // First execution
            {
              level: "INFO",
              message: "=== Simple Logger Demo Starting ===",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "INFO",
              message:
                "This logger does not implement configureDurableLoggingContext",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "DEBUG",
              message:
                "Debug message: Raw logger without DurableLogger wrapper",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "INFO",
              message: "Info message: Using powertools logger directly",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "INFO",
              message: "Before wait operation",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            // Replay - language SDK prevents duplicate logs for custom loggers
            {
              level: "INFO",
              message: "After wait operation - logger still works",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "INFO",
              message: "Info log from step context",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "DEBUG",
              message: "Debug log from step context",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "INFO",
              message: "Info log from child context",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "DEBUG",
              message: "Debug log from child context",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "INFO",
              message: "=== Simple Logger Demo Completed ===",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
          ];

          // Expected stderr logs (WARN and ERROR levels)
          const expectedStderrLogs = [
            // First execution
            {
              level: "WARN",
              message: "Warning message: No durable logging context available",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            // Replay
            {
              level: "WARN",
              message: "Warning log from step context",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "ERROR",
              message: "Error from step context:",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
              error: {
                name: "Error",
                location: expect.any(String),
                message: "Step context error",
                stack: expect.any(String),
              },
            },
            {
              level: "WARN",
              message: "Warning log from child context",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
            },
            {
              level: "ERROR",
              message: "Error from child context:",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
              error: {
                name: "Error",
                location: expect.any(String),
                message: "Child context error",
                stack: expect.any(String),
              },
            },
            {
              level: "ERROR",
              message: "Errors in main context:",
              timestamp: expect.any(String),
              service: "simple-logger",
              sampling_rate: 0,
              error: {
                name: "Error",
                location: expect.any(String),
                message: "Main context error",
                stack: expect.any(String),
              },
            },
          ];

          // Assert exact structure and order for each stream
          expect(stdoutLogs).toStrictEqual(expectedStdoutLogs);
          expect(stderrLogs).toStrictEqual(expectedStderrLogs);

          assertEventSignatures(execution.getHistoryEvents(), historyEvents);
        } finally {
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();
        }
      });
    }
  },
});
