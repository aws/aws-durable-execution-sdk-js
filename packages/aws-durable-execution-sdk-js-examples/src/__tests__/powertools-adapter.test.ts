import { Logger } from "@aws-lambda-powertools/logger";
import {
  createPowertoolsLogger,
  DurableContext,
  DurableInstrumentationPluginFactory,
  DurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  ExecutionStatus,
  LocalDurableTestRunner,
} from "@aws/durable-execution-sdk-js-testing";

// These tests run the adapter against the real Powertools Logger. The adapter
// depends on how Powertools merges its arguments into one log entry. So a
// change in that merge order in a later Powertools release fails these tests.

const DURABLE_DATA = {
  executionArn: "arn:aws:lambda:us-east-1:123456789012:function:fn",
  requestId: "request-1",
  operationId: "op-1",
  operationName: "charge",
  attempt: 2,
};

function captureEntries(): {
  entries: () => Record<string, unknown>[];
  restore: () => void;
} {
  const stdout = jest.spyOn(process.stdout, "write").mockImplementation();
  const stderr = jest.spyOn(process.stderr, "write").mockImplementation();
  return {
    entries: () =>
      [...stdout.mock.calls, ...stderr.mock.calls].map((call) =>
        JSON.parse(String(call[0])),
      ),
    restore: () => {
      stdout.mockRestore();
      stderr.mockRestore();
    },
  };
}

function createAdapter() {
  const adapter = createPowertoolsLogger(
    new Logger({ serviceName: "adapter-test" }),
  );
  adapter.configureDurableLoggingContext({
    getDurableLogData: () => ({ ...DURABLE_DATA, tenantId: undefined }),
  });
  return adapter;
}

describe("createPowertoolsLogger with the real Powertools Logger", () => {
  let capture: ReturnType<typeof captureEntries>;

  beforeEach(() => {
    capture = captureEntries();
  });

  afterEach(() => {
    capture.restore();
  });

  it("adds the durable metadata at the top level of a string-message entry", () => {
    createAdapter().info("hello", { userId: "u-1" });

    expect(capture.entries()).toStrictEqual([
      {
        level: "INFO",
        message: "hello",
        timestamp: expect.any(String),
        service: "adapter-test",
        sampling_rate: 0,
        ...DURABLE_DATA,
        userId: "u-1",
      },
    ]);
  });

  it("adds the durable metadata to a plain-object-message entry", () => {
    createAdapter().info({ message: "hello", userId: "u-1" });

    expect(capture.entries()).toStrictEqual([
      {
        level: "INFO",
        message: "hello",
        timestamp: expect.any(String),
        service: "adapter-test",
        sampling_rate: 0,
        ...DURABLE_DATA,
        userId: "u-1",
      },
    ]);
  });

  it("lets a caller key in the message object replace the metadata key", () => {
    createAdapter().info({ message: "hello", operationName: "caller" });

    expect(capture.entries()[0].operationName).toBe("caller");
  });

  it("lets a caller key in an extra object replace the metadata key", () => {
    createAdapter().info("hello", { operationName: "caller" });

    expect(capture.entries()[0].operationName).toBe("caller");
  });

  it("lets a caller key in a class instance message replace the metadata key", () => {
    class Payload {
      // Powertools types a message object as a record of attributes.
      [key: string]: unknown;
      constructor(
        readonly message: string,
        readonly operationName: string,
      ) {}
    }

    createAdapter().info(new Payload("hello", "caller"));

    const [entry] = capture.entries();
    expect(entry).toEqual(
      expect.objectContaining({
        message: "hello",
        operationName: "caller",
        operationId: DURABLE_DATA.operationId,
      }),
    );
  });

  it("keeps the message of an Error input, and Powertools writes no stack for it", () => {
    // The Powertools types do not accept an Error as the first argument, but
    // Powertools accepts it at run time. JavaScript callers can pass one.
    createAdapter().error(new Error("boom") as unknown as string);

    const [entry] = capture.entries();
    expect(entry).toEqual(
      expect.objectContaining({
        level: "ERROR",
        message: "boom",
        ...DURABLE_DATA,
      }),
    );
    expect(entry).not.toHaveProperty("error");
    expect(entry).not.toHaveProperty("stack");
  });

  it("keeps an appendKeys value for a key that the context has no value for", () => {
    const powertools = new Logger({ serviceName: "adapter-test" });
    powertools.appendKeys({ operationId: "appended", tenantId: "t-appended" });
    const adapter = createPowertoolsLogger(powertools);
    // The root context has no operationId, and this execution has no tenant.
    adapter.configureDurableLoggingContext({
      getDurableLogData: () => ({
        executionArn: DURABLE_DATA.executionArn,
        requestId: DURABLE_DATA.requestId,
        tenantId: undefined,
        operationId: undefined,
      }),
    });

    adapter.info("root");

    expect(capture.entries()[0]).toEqual(
      expect.objectContaining({
        operationId: "appended",
        tenantId: "t-appended",
      }),
    );
  });

  it("lets the durable metadata replace an appendKeys value", () => {
    const powertools = new Logger({ serviceName: "adapter-test" });
    powertools.appendKeys({ operationName: "appended" });
    const adapter = createPowertoolsLogger(powertools);
    adapter.configureDurableLoggingContext({
      getDurableLogData: () => DURABLE_DATA,
    });

    adapter.info("hello");

    expect(capture.entries()[0].operationName).toBe(DURABLE_DATA.operationName);
  });

  it("keeps an Error extra argument under the error key", () => {
    createAdapter().error("failed", new Error("boom"));

    const [entry] = capture.entries();
    expect(entry).toEqual(
      expect.objectContaining({
        message: "failed",
        ...DURABLE_DATA,
        error: expect.objectContaining({ name: "Error", message: "boom" }),
      }),
    );
  });
});

describe("createPowertoolsLogger in a durable execution with a plugin", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  // A plugin that adds a log field, as the OTel plugin adds traceId and spanId.
  const pluginFactory: DurableInstrumentationPluginFactory = {
    createPlugin: () => ({
      enrichLogContext: () => ({ traceId: "trace-1" }),
    }),
  };

  async function runAndCapture(
    useAdapter: boolean,
  ): Promise<Record<string, unknown>[]> {
    const powertools = new Logger({ serviceName: "adapter-plugin-test" });
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext<DurableLogger>) => {
        if (useAdapter) {
          context.configureLogger({
            customLogger: createPowertoolsLogger(powertools),
          });
        }
        context.logger.info("root-entry");
        await context.step("work", async (stepContext) => {
          stepContext.logger.info("step-entry");
        });
        await context.runInChildContext("child", async (childContext) => {
          childContext.logger.info("child-entry");
        });
        return "done";
      },
      { plugins: [pluginFactory] },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const writes: string[] = [];
    const capture = (chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    };
    const stdout = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(capture);
    const stderr = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(capture);
    try {
      const result = await runner.run();
      expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    return writes
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) =>
        ["root-entry", "step-entry", "child-entry"].includes(
          String(entry.message),
        ),
      );
  }

  it("adds the plugin fields to every entry, as the default logger does", async () => {
    const defaultEntries = await runAndCapture(false);
    const adapterEntries = await runAndCapture(true);

    expect(defaultEntries).toHaveLength(3);
    expect(adapterEntries).toHaveLength(3);
    for (const entry of [...defaultEntries, ...adapterEntries]) {
      expect(entry.traceId).toBe("trace-1");
    }
    for (const entry of adapterEntries) {
      expect(entry.service).toBe("adapter-plugin-test");
      expect(entry.executionArn).toEqual(expect.any(String));
    }
  });
});

describe("one createPowertoolsLogger shared by two handlers with different plugins", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("adds the plugin fields of the handler that writes each entry", async () => {
    // One adapter at module scope, as users usually create it.
    const shared = createPowertoolsLogger(
      new Logger({ serviceName: "shared-adapter-test" }),
    );

    // Each handler configures the shared adapter, then waits. Handler "a" waits longer, so
    // handler "b" configures the adapter after "a" has configured it and before "a" logs.
    const makeHandler = (
      name: string,
      pause: number,
      plugins: DurableInstrumentationPluginFactory[],
    ) =>
      withDurableExecution(
        async (_event: unknown, context: DurableContext<DurableLogger>) => {
          context.configureLogger({ customLogger: shared });
          await delay(pause);
          context.logger.info(`root-${name}`);
          await context.step("work", async (stepContext) => {
            await delay(pause);
            stepContext.logger.info(`step-${name}`);
          });
          return name;
        },
        { plugins },
      );

    const handlerA = makeHandler("a", 50, [
      {
        createPlugin: () => ({
          enrichLogContext: () => ({ traceId: "trace-a" }),
        }),
      },
    ]);
    const handlerB = makeHandler("b", 5, [
      {
        createPlugin: () => ({
          enrichLogContext: () => ({ traceId: "trace-b" }),
        }),
      },
    ]);
    // A third handler with no plugin. Its entries must carry no plugin field.
    const handlerC = makeHandler("c", 20, []);

    const writes: string[] = [];
    const capture = (chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    };
    const stdout = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(capture);
    const stderr = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(capture);
    try {
      const results = await Promise.all(
        [handlerA, handlerB, handlerC].map((handlerFunction) =>
          new LocalDurableTestRunner({ handlerFunction }).run(),
        ),
      );
      for (const result of results) {
        expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    const entries = writes
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.service === "shared-adapter-test");

    expect(entries.map((entry) => entry.message).sort()).toEqual([
      "root-a",
      "root-b",
      "root-c",
      "step-a",
      "step-b",
      "step-c",
    ]);
    const expectedTraceId: Record<string, string | undefined> = {
      a: "trace-a",
      b: "trace-b",
      c: undefined,
    };
    for (const entry of entries) {
      const name = String(entry.message).slice(-1);
      expect({ message: entry.message, traceId: entry.traceId }).toEqual({
        message: entry.message,
        traceId: expectedTraceId[name],
      });
    }
  });
});
