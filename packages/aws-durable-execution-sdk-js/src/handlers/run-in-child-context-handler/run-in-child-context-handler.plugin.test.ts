import { createRunInChildContextHandler } from "./run-in-child-context-handler";
import { ExecutionContext } from "../../types";
import { getStepData } from "../../utils/step-id-utils/step-id-utils";
import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import {
  DurableInstrumentationPlugin,
  PluginOperationStatus,
} from "../../types/plugin";

jest.mock("../../utils/logger/logger");

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe("RunInChildContext Handler - plugin hooks", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let mockParentContext: any;
  let createStepId: jest.Mock;
  let mockPlugin: jest.Mocked<DurableInstrumentationPlugin>;
  let mockGetLogger: jest.Mock;
  let mockCreateChildContext: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockExecutionContext = {
      _stepData: {},
      terminationManager: { terminate: jest.fn() },
      getStepData: jest.fn((stepId: string) => {
        return getStepData(mockExecutionContext._stepData, stepId);
      }),
    } as unknown as jest.Mocked<ExecutionContext>;
    mockCheckpoint = createMockCheckpoint();
    mockParentContext = { awsRequestId: "mock-request-id" };
    createStepId = jest.fn().mockReturnValue(TEST_CONSTANTS.CHILD_CONTEXT_ID);
    mockPlugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
      wrapChildContextFn: jest.fn(),
    };

    (mockPlugin.wrapChildContextFn as jest.Mock).mockImplementation(
      (_info: unknown, fn: () => unknown) => fn(),
    );
    mockGetLogger = jest.fn().mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    mockCreateChildContext = jest.fn().mockReturnValue({
      _stepPrefix: TEST_CONSTANTS.CHILD_CONTEXT_ID,
    });
  });

  it("should call onOperationStart, wrapChildContextFn, and onOperationEnd on successful execution", async () => {
    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      undefined,
      mockPlugin,
    );

    const childFn = jest.fn().mockResolvedValue("result");
    await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);
    await flushMicrotasks();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.wrapChildContextFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapChildContextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        isReplay: false,
      }),
      expect.any(Function),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it("should call wrapChildContextFn and onOperationEnd with error on failed execution", async () => {
    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      undefined,
      mockPlugin,
    );

    const childFn = jest.fn().mockRejectedValue(new Error("child failed"));

    await expect(
      handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn),
    ).rejects.toThrow("child failed");
    await flushMicrotasks();

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.wrapChildContextFn).toHaveBeenCalledTimes(1);
    expect(mockPlugin.wrapChildContextFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: TEST_CONSTANTS.CHILD_CONTEXT_NAME,
        isReplay: false,
      }),
      expect.any(Function),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false, error: expect.any(Error) }),
    );
  });

  it("should propagate errors thrown within wrapChildContextFn", async () => {
    const wrapError = new Error("wrapChildContextFn exploded");

    (mockPlugin.wrapChildContextFn as jest.Mock).mockImplementation(
      (info, fn) => {
        fn();
        throw wrapError;
      },
    );

    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      undefined,
      mockPlugin,
    );

    const childFn = jest.fn().mockResolvedValue("result");

    await expect(
      handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn),
    ).rejects.toThrow("wrapChildContextFn exploded");

    expect(childFn).toHaveBeenCalled();
  });

  it("should not throw when plugin hooks are undefined", async () => {
    const handler = createRunInChildContextHandler(
      mockExecutionContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      mockGetLogger,
      mockCreateChildContext,
      "parent-123",
      undefined,
      {},
    );

    const childFn = jest.fn().mockResolvedValue("result");
    const result = await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);
    expect(result).toBe("result");
  });

  describe("virtual context - isReplay flag", () => {
    it("should call onOperationStart with isReplay true for virtual context", async () => {
      const handler = createRunInChildContextHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        mockGetLogger,
        mockCreateChildContext,
        "parent-123",
        undefined,
        mockPlugin,
      );

      const childFn = jest.fn().mockResolvedValue("result");
      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {
        virtualContext: true,
      });
      await flushMicrotasks();

      expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
        expect.objectContaining({ isReplay: true }),
      );
    });

    it("should call onOperationEnd with isReplay true for virtual context on success", async () => {
      const handler = createRunInChildContextHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        mockGetLogger,
        mockCreateChildContext,
        "parent-123",
        undefined,
        mockPlugin,
      );

      const childFn = jest.fn().mockResolvedValue("result");
      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {
        virtualContext: true,
      });
      await flushMicrotasks();

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          isReplay: true,
          status: PluginOperationStatus.SUCCEEDED,
        }),
      );
    });

    it("should call onOperationEnd with isReplay true for virtual context on failure", async () => {
      const handler = createRunInChildContextHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        mockGetLogger,
        mockCreateChildContext,
        "parent-123",
        undefined,
        mockPlugin,
      );

      const childFn = jest.fn().mockRejectedValue(new Error("child failed"));

      await expect(
        handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {
          virtualContext: true,
        }),
      ).rejects.toThrow("child failed");
      await flushMicrotasks();

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          isReplay: true,
          status: PluginOperationStatus.FAILED,
          error: expect.any(Error),
        }),
      );
    });

    it("should call both onOperationStart and onOperationEnd with isReplay true for virtual context regardless of step data", async () => {
      // Simulate step data already existing (e.g. a retry scenario)
      mockExecutionContext._stepData[TEST_CONSTANTS.CHILD_CONTEXT_ID] = {
        Status: "STARTED",
      } as any;

      const handler = createRunInChildContextHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        mockGetLogger,
        mockCreateChildContext,
        "parent-123",
        undefined,
        mockPlugin,
      );

      const childFn = jest.fn().mockResolvedValue("result");
      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn, {
        virtualContext: true,
      });
      await flushMicrotasks();

      expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
        expect.objectContaining({ isReplay: true }),
      );
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          isReplay: true,
          status: PluginOperationStatus.SUCCEEDED,
        }),
      );
    });

    it("should NOT call onOperationStart with isReplay true for non-virtual context on first execution", async () => {
      const handler = createRunInChildContextHandler(
        mockExecutionContext,
        mockCheckpoint,
        mockParentContext,
        createStepId,
        mockGetLogger,
        mockCreateChildContext,
        "parent-123",
        undefined,
        mockPlugin,
      );

      const childFn = jest.fn().mockResolvedValue("result");
      await handler(TEST_CONSTANTS.CHILD_CONTEXT_NAME, childFn);
      await flushMicrotasks();

      expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
        expect.objectContaining({ isReplay: false }),
      );
    });
  });
});
