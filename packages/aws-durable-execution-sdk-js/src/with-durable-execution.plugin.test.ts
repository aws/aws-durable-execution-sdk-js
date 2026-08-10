import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";
import { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionMode,
  InvocationStatus,
} from "./types";
import {
  DurableInstrumentationPlugin,
  PluginInvocationStatus,
} from "./types/plugin";
import { TEST_CONSTANTS } from "./testing/test-constants";
import { loadConfiguredPlugins } from "./utils/plugin/plugin-loader";
import { PluginLoadError } from "./errors/plugin-load-error/plugin-load-error";

jest.mock("./context/execution-context/execution-context");
jest.mock("./context/durable-context/durable-context");
jest.mock("./utils/checkpoint/checkpoint-manager");
jest.mock("./utils/logger/logger", () => ({ log: jest.fn() }));
jest.mock("./utils/plugin/plugin-loader", () => ({
  loadConfiguredPlugins: jest.fn(),
}));

const mockEvent: DurableExecutionInvocationInput = {
  CheckpointToken: "token",
  DurableExecutionArn: "arn:test",
  InitialExecutionState: { Operations: [], NextMarker: "" },
};
const mockContext = {} as Context;
// Flush the microtask queue without advancing fake timers, so we can observe
// whether a promise is still pending after all currently-scheduled
// microtasks have run.
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
};
const mockTerminationManager = {
  getTerminationPromise: jest.fn(),
  terminate: jest.fn(),
  setCheckpointTerminatingCallback: jest.fn(),
};
const mockExecutionContext = {
  _stepData: {
    "initial-op": {
      StartTimestamp: new Date("2024-06-01T12:00:00Z"),
      ExecutionDetails: {
        InputPayload: "{}",
      },
    },
  },
  durableExecutionArn: "arn:test",
  requestId: "req-123",
  terminationManager: mockTerminationManager,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (
    loadConfiguredPlugins as jest.MockedFunction<typeof loadConfiguredPlugins>
  ).mockImplementation(async (plugins) => [...(plugins ?? [])]);
  (initializeExecutionContext as jest.Mock).mockResolvedValue({
    executionContext: mockExecutionContext,
    checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
    durableExecutionMode: DurableExecutionMode.ExecutionMode,
  });
  (createDurableContext as jest.Mock).mockReturnValue({});
  (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
    checkpoint: jest.fn().mockResolvedValue(undefined),
    setTerminating: jest.fn(),
    dispose: jest.fn(),
    waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
  }));
  mockTerminationManager.getTerminationPromise.mockReturnValue(
    new Promise(() => {}),
  );
});

afterEach(() => jest.useRealTimers());

describe("plugin hooks", () => {
  let plugin: jest.Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    plugin = {
      onInvocationStart: jest.fn(),
      onInvocationEnd: jest.fn(),
    };
  });

  it("calls onInvocationStart with isFirstInvocation=true on first invocation", async () => {
    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationStart).toHaveBeenCalledWith({
      requestId: "req-123",
      executionArn: "arn:test",
      isFirstInvocation: true,
      executionInput: expect.anything(),
      operations: expect.any(Object),
      updatedOperations: expect.any(Object),
      executionStartTimestamp: new Date("2024-06-01T12:00:00Z"),
    });
  });

  it("calls onInvocationStart without isFirstInvocation on replay invocations", async () => {
    (initializeExecutionContext as jest.Mock).mockResolvedValue({
      executionContext: mockExecutionContext,
      checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
      durableExecutionMode: DurableExecutionMode.ReplayMode,
    });

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationStart).toHaveBeenCalledWith({
      requestId: "req-123",
      executionArn: "arn:test",
      isFirstInvocation: false,
      executionInput: expect.anything(),
      operations: expect.any(Object),
      updatedOperations: expect.any(Object),
      executionStartTimestamp: new Date("2024-06-01T12:00:00Z"),
    });
  });

  it("calls onInvocationEnd with SUCCEEDED status on normal completion", async () => {
    const result = { ok: true };
    const handler = withDurableExecution(jest.fn().mockResolvedValue(result), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-123",
        executionArn: "arn:test",
        status: PluginInvocationStatus.SUCCEEDED,
        executionResult: result,
        executionError: undefined,
        executionInput: expect.anything(),
        operations: expect.any(Object),
      }),
    );
  });

  it("calls onInvocationEnd with FAILED status when handler throws", async () => {
    const error = new Error("handler error");
    const handler = withDurableExecution(jest.fn().mockRejectedValue(error), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-123",
        executionArn: "arn:test",
        status: PluginInvocationStatus.FAILED,
        executionError: error,
        executionResult: undefined,
        executionInput: expect.anything(),
        operations: expect.any(Object),
      }),
    );
  });

  it("calls onInvocationEnd exactly once per invocation even when handler throws", async () => {
    const handler = withDurableExecution(
      jest.fn().mockRejectedValue(new Error("boom")),
      { plugins: [plugin] },
    );
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationEnd).toHaveBeenCalledTimes(1);
  });

  it("waits for an async onInvocationEnd to complete before the handler resolves", async () => {
    // Gate the hook so the test controls exactly when it finishes. If the SDK
    // awaits onInvocationEnd, the handler stays pending until we release the
    // gate. If it were fire-and-forget, the handler would resolve early.
    let releaseHook!: () => void;
    const hookGate = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    let hookCompleted = false;
    const asyncPlugin: DurableInstrumentationPlugin = {
      onInvocationEnd: async () => {
        await hookGate;
        hookCompleted = true;
      },
    };

    const handler = withDurableExecution(
      jest.fn().mockResolvedValue({ ok: true }),
      { plugins: [asyncPlugin] },
    );

    let handlerResolved = false;
    const handlerPromise = handler(mockEvent, mockContext).then((r) => {
      handlerResolved = true;
      return r;
    });

    // Flush all pending microtasks; the handler must remain blocked on the hook
    await flushMicrotasks();
    expect(hookCompleted).toBe(false);
    expect(handlerResolved).toBe(false);

    // Release the hook; only now may the handler resolve
    releaseHook();
    await handlerPromise;

    expect(hookCompleted).toBe(true);
    expect(handlerResolved).toBe(true);
  });

  it("waits for async onInvocationEnd even when the handler throws", async () => {
    let releaseHook!: () => void;
    const hookGate = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    let hookCompleted = false;
    const asyncPlugin: DurableInstrumentationPlugin = {
      onInvocationEnd: async () => {
        await hookGate;
        hookCompleted = true;
      },
    };

    const handler = withDurableExecution(
      jest.fn().mockRejectedValue(new Error("handler error")),
      { plugins: [asyncPlugin] },
    );

    let handlerResolved = false;
    const handlerPromise = handler(mockEvent, mockContext).then((r) => {
      handlerResolved = true;
      return r;
    });

    await flushMicrotasks();
    expect(hookCompleted).toBe(false);
    expect(handlerResolved).toBe(false);

    releaseHook();
    await handlerPromise;

    expect(hookCompleted).toBe(true);
    expect(handlerResolved).toBe(true);
  });

  it("fans out hooks to multiple plugins", async () => {
    const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
      onInvocationStart: jest.fn(),
      onInvocationEnd: jest.fn(),
    };

    const handler = withDurableExecution(
      jest.fn().mockResolvedValue({ ok: true }),
      {
        plugins: [plugin, plugin2],
      },
    );
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationStart).toHaveBeenCalled();
    expect(plugin2.onInvocationStart).toHaveBeenCalled();
    expect(plugin.onInvocationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PluginInvocationStatus.SUCCEEDED,
        executionInput: expect.anything(),
        operations: expect.any(Object),
      }),
    );
    expect(plugin2.onInvocationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PluginInvocationStatus.SUCCEEDED,
        executionInput: expect.anything(),
        operations: expect.any(Object),
      }),
    );
  });

  it("loads configured plugins once when the wrapped handler is initialized", async () => {
    const dynamicPlugin: jest.Mocked<DurableInstrumentationPlugin> = {
      onInvocationStart: jest.fn(),
      onInvocationEnd: jest.fn(),
    };
    (
      loadConfiguredPlugins as jest.MockedFunction<typeof loadConfiguredPlugins>
    ).mockResolvedValueOnce([plugin, dynamicPlugin]);

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [plugin],
    });

    expect(loadConfiguredPlugins).toHaveBeenCalledTimes(1);
    expect(loadConfiguredPlugins).toHaveBeenCalledWith([plugin]);

    await handler(mockEvent, mockContext);
    await handler(mockEvent, mockContext);

    expect(loadConfiguredPlugins).toHaveBeenCalledTimes(1);
    expect(plugin.onInvocationStart).toHaveBeenCalledTimes(2);
    expect(dynamicPlugin.onInvocationStart).toHaveBeenCalledTimes(2);
  });

  it("fails plugin loading errors before reading execution state", async () => {
    const pluginLoadError = new PluginLoadError(
      "invalid dynamic plugin configuration",
    );
    (
      loadConfiguredPlugins as jest.MockedFunction<typeof loadConfiguredPlugins>
    ).mockRejectedValueOnce(pluginLoadError);

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}));

    await expect(handler(mockEvent, mockContext)).resolves.toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorMessage: pluginLoadError.message,
        ErrorType: pluginLoadError.name,
      }),
    });
    expect(initializeExecutionContext).not.toHaveBeenCalled();
  });

  it("plugin errors do not affect SDK execution", async () => {
    const throwingPlugin: DurableInstrumentationPlugin = {
      onInvocationStart: () => {
        throw new Error("plugin bug");
      },
      wrapInvocation: () => {
        throw new Error("plugin bug");
      },
      onInvocationEnd: () => {
        throw new Error("plugin bug");
      },
    };

    const handler = withDurableExecution(
      jest.fn().mockResolvedValue({ ok: true }),
      { plugins: [throwingPlugin] },
    );

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: "SUCCEEDED",
    });
  });

  it("enrichLogContext merges results from all plugins", () => {
    const pluginA: DurableInstrumentationPlugin = {
      enrichLogContext: () => ({ traceId: "abc" }),
    };
    const pluginB: DurableInstrumentationPlugin = {
      enrichLogContext: () => ({ spanId: "xyz" }),
    };

    const { createPluginRunner } = jest.requireActual(
      "./utils/plugin/plugin-runner",
    );
    const runner = createPluginRunner([pluginA, pluginB]);

    expect(runner.enrichLogContext?.()).toEqual({
      traceId: "abc",
      spanId: "xyz",
    });
  });
});

describe("onInvocationEnd receives correct InvocationEndInfo on success", () => {
  it.each([
    { desc: "string result", returnValue: "hello world" },
    { desc: "number result", returnValue: 42 },
    { desc: "null result", returnValue: null },
    { desc: "boolean result", returnValue: true },
    { desc: "object result", returnValue: { foo: "bar", nested: { x: 1 } } },
    { desc: "array result", returnValue: [1, "two", { three: 3 }] },
    { desc: "empty object", returnValue: {} },
    { desc: "empty array", returnValue: [] },
    {
      desc: "deeply nested",
      returnValue: { a: { b: { c: { d: [1, 2, 3] } } } },
    },
    { desc: "special characters", returnValue: { msg: 'hello\n\t"world"' } },
  ])(
    "onInvocationEnd receives SUCCEEDED with $desc",
    async ({ returnValue }) => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
        onInvocationEnd: jest.fn(),
      };

      const handler = withDurableExecution(
        jest.fn().mockResolvedValue(returnValue),
        { plugins: [plugin] },
      );
      await handler(mockEvent, mockContext);

      expect(plugin.onInvocationEnd).toHaveBeenCalledTimes(1);
      const endInfo = (plugin.onInvocationEnd as jest.Mock).mock.calls[0][0];

      expect(endInfo.status).toBe(PluginInvocationStatus.SUCCEEDED);
      expect(endInfo.executionResult).toEqual(returnValue);
      expect(endInfo.executionError).toBeUndefined();
    },
  );
});

describe("RETRYING never appears in Lambda response output", () => {
  const validStatuses = [
    InvocationStatus.SUCCEEDED,
    InvocationStatus.FAILED,
    InvocationStatus.PENDING,
  ];

  it.each([
    { desc: "string return", returnValue: "result" },
    { desc: "number return", returnValue: 123 },
    { desc: "null return", returnValue: null },
    { desc: "object return", returnValue: { ok: true } },
    { desc: "array return", returnValue: [1, 2, 3] },
    { desc: "boolean return", returnValue: false },
  ])(
    "output Status is never RETRYING for successful handler: $desc",
    async ({ returnValue }) => {
      const handler = withDurableExecution(
        jest.fn().mockResolvedValue(returnValue),
        { plugins: [] },
      );
      const output = await handler(mockEvent, mockContext);

      expect(validStatuses).toContain(output.Status);
      expect(output.Status).not.toBe("RETRYING");
    },
  );

  it.each([
    { desc: "simple error", errorMessage: "something went wrong" },
    { desc: "empty message", errorMessage: "" },
    { desc: "special characters", errorMessage: 'error: "unexpected" <token>' },
    { desc: "long message", errorMessage: "x".repeat(500) },
    { desc: "unicode message", errorMessage: "错误发生了 🚨" },
  ])(
    "output Status is never RETRYING for failing handler: $desc",
    async ({ errorMessage }) => {
      const handler = withDurableExecution(
        jest.fn().mockRejectedValue(new Error(errorMessage)),
        { plugins: [] },
      );
      const output = await handler(mockEvent, mockContext);

      expect(validStatuses).toContain(output.Status);
      expect(output.Status).not.toBe("RETRYING");
    },
  );
});

describe("onInvocationEnd receives correct InvocationEndInfo on failure", () => {
  it.each([
    { desc: "simple error", errorMessage: "handler failed" },
    { desc: "empty message", errorMessage: "" },
    { desc: "special characters", errorMessage: 'err: "oops" & <bad>' },
    { desc: "long message", errorMessage: "a".repeat(200) },
    { desc: "unicode message", errorMessage: "失敗しました 💥" },
    { desc: "multiline", errorMessage: "line1\nline2\nline3" },
  ])(
    "onInvocationEnd receives FAILED with correct error: $desc",
    async ({ errorMessage }) => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
        onInvocationEnd: jest.fn(),
      };

      const thrownError = new Error(errorMessage);
      const handler = withDurableExecution(
        jest.fn().mockRejectedValue(thrownError),
        { plugins: [plugin] },
      );
      await handler(mockEvent, mockContext);

      expect(plugin.onInvocationEnd).toHaveBeenCalledTimes(1);
      const endInfo = (plugin.onInvocationEnd as jest.Mock).mock.calls[0][0];

      expect(endInfo.status).toBe(PluginInvocationStatus.FAILED);
      expect(endInfo.executionError).toBeInstanceOf(Error);
      expect(endInfo.executionError.message).toBe(errorMessage);
      expect(endInfo.executionResult).toBeUndefined();
    },
  );
});
