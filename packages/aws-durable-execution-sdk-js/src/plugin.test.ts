import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";
import { Context } from "aws-lambda";
import { DurableExecutionInvocationInput, DurableExecutionMode } from "./types";
import { DurableInstrumentationPlugin } from "./types/plugin";
import { TEST_CONSTANTS } from "./testing/test-constants";

jest.mock("./context/execution-context/execution-context");
jest.mock("./context/durable-context/durable-context");
jest.mock("./utils/checkpoint/checkpoint-manager");
jest.mock("./utils/logger/logger", () => ({ log: jest.fn() }));

const mockEvent: DurableExecutionInvocationInput = {
  CheckpointToken: "token",
  DurableExecutionArn: "arn:test",
  InitialExecutionState: { Operations: [], NextMarker: "" },
};
const mockContext = {} as Context;
const mockTerminationManager = {
  getTerminationPromise: jest.fn(),
  terminate: jest.fn(),
  setCheckpointTerminatingCallback: jest.fn(),
};
const mockExecutionContext = {
  _stepData: {},
  durableExecutionArn: "arn:test",
  requestId: "req-123",
  terminationManager: mockTerminationManager,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (initializeExecutionContext as jest.Mock).mockResolvedValue({
    executionContext: mockExecutionContext,
    checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
    durableExecutionMode: DurableExecutionMode.ExecutionMode,
  });
  (createDurableContext as jest.Mock).mockReturnValue({});
  (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
    checkpoint: jest.fn().mockResolvedValue(undefined),
    setTerminating: jest.fn(),
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
      onExecutionStart: jest.fn(),
      onExecutionEnd: jest.fn(),
      onInvocationStart: jest.fn(),
      onInvocationEnd: jest.fn(),
    };
  });

  it("calls onExecutionStart and onInvocationStart on first invocation", async () => {
    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onExecutionStart).toHaveBeenCalledWith({
      requestId: "req-123",
      executionArn: "arn:test",
    });
    expect(plugin.onInvocationStart).toHaveBeenCalledWith({
      requestId: "req-123",
      executionArn: "arn:test",
    });
  });

  it("does not call onExecutionStart on replay invocations", async () => {
    (initializeExecutionContext as jest.Mock).mockResolvedValue({
      executionContext: mockExecutionContext,
      checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
      durableExecutionMode: DurableExecutionMode.ReplayMode,
    });

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onExecutionStart).not.toHaveBeenCalled();
    expect(plugin.onInvocationStart).toHaveBeenCalled();
  });

  it("calls onInvocationEnd in finally — even when handler throws", async () => {
    const handler = withDurableExecution(
      jest.fn().mockRejectedValue(new Error("boom")),
      { plugins: [plugin] },
    );
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationEnd).toHaveBeenCalledWith({
      requestId: "req-123",
      executionArn: "arn:test",
    });
  });

  it("calls onExecutionEnd with SUCCEEDED status on normal completion", async () => {
    const result = { ok: true };
    const handler = withDurableExecution(jest.fn().mockResolvedValue(result), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onExecutionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        executionResult: result,
        executionArn: "arn:test",
      }),
    );
  });

  it("calls onExecutionEnd with FAILED status when handler throws", async () => {
    const error = new Error("handler error");
    const handler = withDurableExecution(jest.fn().mockRejectedValue(error), {
      plugins: [plugin],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onExecutionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        executionError: error,
        executionArn: "arn:test",
      }),
    );
  });

  it("fans out hooks to multiple plugins", async () => {
    const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
      onInvocationStart: jest.fn(),
      onInvocationEnd: jest.fn(),
    };

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [plugin, plugin2],
    });
    await handler(mockEvent, mockContext);

    expect(plugin.onInvocationStart).toHaveBeenCalled();
    expect(plugin2.onInvocationStart).toHaveBeenCalled();
  });

  it("enrichLogContext merges results from all plugins", () => {
    const pluginA: DurableInstrumentationPlugin = {
      enrichLogContext: () => ({ traceId: "abc" }),
    };
    const pluginB: DurableInstrumentationPlugin = {
      enrichLogContext: () => ({ spanId: "xyz" }),
    };

    // Access the runner directly via createPluginRunner
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

describe("shouldSampleExecution", () => {
  it("always returns true when rate is 1.0", () => {
    const { shouldSampleExecution } = jest.requireActual("./types/plugin");
    expect(shouldSampleExecution("arn:test", 1.0)).toBe(true);
  });

  it("always returns false when rate is 0.0", () => {
    const { shouldSampleExecution } = jest.requireActual("./types/plugin");
    expect(shouldSampleExecution("arn:test", 0.0)).toBe(false);
  });

  it("is deterministic — same arn always gives same result", () => {
    const { shouldSampleExecution } = jest.requireActual("./types/plugin");
    const arn = "arn:aws:lambda:us-east-1:123:function:my-fn:1/exec/abc";
    const result = shouldSampleExecution(arn, 0.5);
    expect(shouldSampleExecution(arn, 0.5)).toBe(result);
    expect(shouldSampleExecution(arn, 0.5)).toBe(result);
  });
});
