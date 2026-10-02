import { createStepHandler } from "./step-handler";
import { ExecutionContext, OperationSubType, StepSemantics } from "../../types";
import { OperationStatus, OperationType } from "../../types/wire";
import { Context } from "aws-lambda";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");

// StepConfig.subType replaces the default "Step" subtype everywhere the step
// handler records one: checkpoints, replay validation, lifecycle metadata,
// and plugin events.
describe("Step Handler subType", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let stepIdCounter: number;

  const handler = (
    plugin: DurableInstrumentationPlugin = {},
  ): ReturnType<typeof createStepHandler> =>
    createStepHandler(
      mockContext,
      mockCheckpoint,
      {} as Context,
      () => `step-${++stepIdCounter}`,
      createDefaultLogger(),
      undefined,
      undefined,
      plugin,
    );

  const checkpointedSubTypes = (): unknown[] =>
    (mockCheckpoint.checkpoint as jest.Mock).mock.calls.map(
      (call) => call[1].SubType,
    );

  const lifecycleSubTypes = (): unknown[] =>
    (mockCheckpoint.markOperationState as jest.Mock).mock.calls
      .map((call) => call[2]?.metadata?.subType)
      .filter((subType) => subType !== undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;
    mockContext = {
      getStepData: jest.fn().mockReturnValue(undefined),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: { terminate: jest.fn() },
    } as unknown as ExecutionContext;
    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForRetryTimer: jest.fn().mockResolvedValue(undefined),
    } as unknown as Checkpoint;
  });

  it("records the default Step subtype when no subType is set", async () => {
    await handler()("plain", async () => "ok");

    expect(checkpointedSubTypes()).toEqual([
      OperationSubType.STEP,
      OperationSubType.STEP,
    ]);
    expect(lifecycleSubTypes()).toEqual([OperationSubType.STEP]);
  });

  it("records the custom subtype on START and SUCCEED", async () => {
    await handler()("launch", async () => "ok", { subType: "OrderLaunch" });

    expect(
      (mockCheckpoint.checkpoint as jest.Mock).mock.calls.map((call) => [
        call[1].Action,
        call[1].Type,
        call[1].SubType,
      ]),
    ).toEqual([
      ["START", OperationType.STEP, "OrderLaunch"],
      ["SUCCEED", OperationType.STEP, "OrderLaunch"],
    ]);
    expect(lifecycleSubTypes()).toEqual(["OrderLaunch"]);
  });

  it("records the custom subtype on RETRY and FAIL", async () => {
    const error = new Error("boom");
    // The mock returns no step data, so the handler reports attempt 1 each
    // time. Count calls instead.
    let decisions = 0;
    const promise = handler()(
      "launch",
      async () => {
        throw error;
      },
      {
        subType: "OrderLaunch",
        retryStrategy: () => ({
          shouldRetry: ++decisions < 2,
          delay: { seconds: 1 },
        }),
      },
    );

    await expect(promise).rejects.toThrow("boom");
    expect(
      (mockCheckpoint.checkpoint as jest.Mock).mock.calls.map((call) => [
        call[1].Action,
        call[1].SubType,
      ]),
    ).toEqual([
      ["START", "OrderLaunch"],
      ["RETRY", "OrderLaunch"],
      // The mock returns no step data, so the second attempt starts again.
      ["START", "OrderLaunch"],
      ["FAIL", "OrderLaunch"],
    ]);
  });

  it("records the custom subtype for an interrupted at-most-once step", async () => {
    const stepId = hashId("step-1");
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: stepId,
      Type: OperationType.STEP,
      Name: "terminate",
      SubType: "OrderTerminate",
      Status: OperationStatus.STARTED,
      StepDetails: { Attempt: 0 },
    });

    const promise = handler()("terminate", async () => "ok", {
      subType: "OrderTerminate",
      semantics: StepSemantics.AtMostOncePerRetry,
      retryStrategy: () => ({ shouldRetry: false }),
    });

    await expect(promise).rejects.toThrow();
    expect(checkpointedSubTypes()).toEqual(["OrderTerminate"]);
  });

  it("passes the custom subtype to plugin events", async () => {
    const onOperationStart = jest.fn();
    const onOperationEnd = jest.fn();

    await handler({ onOperationStart, onOperationEnd })(
      "launch",
      async () => "ok",
      { subType: "OrderLaunch" },
    );

    expect(onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ subType: "OrderLaunch" }),
    );
    expect(onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ subType: "OrderLaunch" }),
    );
  });

  it("replays a completed step whose checkpoint has the same subtype", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: hashId("step-1"),
      Type: OperationType.STEP,
      Name: "launch",
      SubType: "OrderLaunch",
      Status: OperationStatus.SUCCEEDED,
      StepDetails: { Result: JSON.stringify("cached") },
    });
    const fn = jest.fn();

    const result = await handler()("launch", fn, { subType: "OrderLaunch" });

    expect(result).toBe("cached");
    expect(fn).not.toHaveBeenCalled();
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });

  it("terminates as non-deterministic when the replayed subtype differs", () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: hashId("step-1"),
      Type: OperationType.STEP,
      Name: "launch",
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StepDetails: { Result: JSON.stringify("cached") },
    });

    void handler()("launch", async () => "ok", { subType: "OrderLaunch" });

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          'Expected subtype "Step", but got "OrderLaunch"',
        ),
      }),
    );
  });
});
