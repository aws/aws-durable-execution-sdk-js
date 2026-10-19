import {
  DurableContext,
  DurableLogData,
  DurableLogger,
  DurableLoggingContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExecutionStatus } from "@aws-sdk/client-lambda";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

interface Entry {
  message: string;
  data: DurableLogData | undefined;
}

/**
 * A custom logger that keeps the last logging context it was given. Custom loggers that read
 * `getDurableLogData()` per call are written this way, including the SDK's Powertools adapter.
 */
class RecordingLogger implements DurableLogger {
  readonly entries: Entry[] = [];
  private loggingContext: DurableLoggingContext | undefined;

  configureDurableLoggingContext(loggingContext: DurableLoggingContext): void {
    this.loggingContext = loggingContext;
  }

  info(message: string): void {
    this.entries.push({
      message,
      data: this.loggingContext?.getDurableLogData(),
    });
  }

  warn(): void {
    // Not used by the test.
  }
  error(): void {
    // Not used by the test.
  }
  debug(): void {
    // Not used by the test.
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One logger instance shared by two executions that run at the same time in one process.
 *
 * Each `DurableContext` gives the logger its own logging context, so the logger holds the
 * context of whichever execution configured it last. The log data must still identify the
 * execution that wrote each entry.
 */
describe("a logger shared by concurrent executions", () => {
  it("logs the executionArn and requestId of the execution that writes each entry", async () => {
    const shared = new RecordingLogger();
    const arnByName = new Map<string, string>();

    const handler = withDurableExecution(
      async (event: { name: string }, context: DurableContext) => {
        context.configureLogger({ customLogger: shared });
        arnByName.set(event.name, context.executionContext.durableExecutionArn);

        // Execution "a" waits longer, so execution "b" configures the shared logger after
        // "a" has configured it and before "a" logs.
        const pause = event.name === "a" ? 50 : 5;
        await delay(pause);
        context.logger.info(`root-${event.name}`);

        await context.step("work", async (stepContext) => {
          await delay(pause);
          stepContext.logger.info(`step-${event.name}`);
        });

        await context.runInChildContext("child", async (childContext) => {
          await delay(pause);
          childContext.logger.info(`child-${event.name}`);
        });

        return event.name;
      },
    );

    const runnerA = new LocalDurableTestRunner({ handlerFunction: handler });
    const runnerB = new LocalDurableTestRunner({ handlerFunction: handler });

    const [resultA, resultB] = await Promise.all([
      runnerA.run({ payload: { name: "a" } }),
      runnerB.run({ payload: { name: "b" } }),
    ]);

    expect(resultA.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(resultB.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(arnByName.get("a")).not.toBe(arnByName.get("b"));

    // Mode-aware logging writes each message once, in the invocation that runs it first.
    const messages = shared.entries.map((entry) => entry.message).sort();
    expect(messages).toEqual([
      "child-a",
      "child-b",
      "root-a",
      "root-b",
      "step-a",
      "step-b",
    ]);

    const requestIdByName = new Map<string, Set<string | undefined>>();
    for (const entry of shared.entries) {
      const name = entry.message.slice(-1);
      expect({
        message: entry.message,
        executionArn: entry.data?.executionArn,
      }).toEqual({
        message: entry.message,
        executionArn: arnByName.get(name),
      });
      const ids = requestIdByName.get(name) ?? new Set();
      ids.add(entry.data?.requestId);
      requestIdByName.set(name, ids);
    }

    // Each execution logs its own request IDs. The two executions share none.
    const idsA = [...(requestIdByName.get("a") ?? [])];
    const idsB = new Set(requestIdByName.get("b"));
    expect(idsA.filter((id) => idsB.has(id))).toEqual([]);
  });
});
