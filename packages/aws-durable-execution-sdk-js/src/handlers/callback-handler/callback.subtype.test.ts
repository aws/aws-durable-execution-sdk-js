import { createCallback } from "./callback";
import { ExecutionContext, OperationSubType } from "../../types";
import { Operation, OperationStatus, OperationType } from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");

// CreateCallbackConfig.subType replaces the default "Callback" subtype
// everywhere the callback handler records one: the START checkpoint, replay
// validation, lifecycle metadata, and plugin events.
describe("Callback Handler subType", () => {
  const stepId = "callback-step";
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let stepData: Operation | undefined;

  const handler = (
    plugin: DurableInstrumentationPlugin = {},
  ): ReturnType<typeof createCallback> =>
    createCallback(
      mockContext,
      mockCheckpoint,
      () => stepId,
      jest.fn(),
      undefined,
      undefined,
      plugin,
    );

  const lifecycleSubTypes = (): unknown[] =>
    (mockCheckpoint.markOperationState as jest.Mock).mock.calls
      .map((call) => call[2]?.metadata?.subType)
      .filter((subType) => subType !== undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    stepData = undefined;
    mockContext = {
      getStepData: jest.fn(() => stepData),
      _stepData: {},
      durableExecutionArn: "test-arn",
      terminationManager: { terminate: jest.fn() },
      isOperationUpdatedBetweenInvocation: jest.fn().mockReturnValue(false),
    } as unknown as ExecutionContext;
    mockCheckpoint = {
      // The START checkpoint makes the service assign a callback ID.
      checkpoint: jest.fn(async (_id: string, update: { SubType: string }) => {
        stepData = {
          Id: hashId(stepId),
          Type: OperationType.CALLBACK,
          SubType: update.SubType,
          Status: OperationStatus.STARTED,
          CallbackDetails: { CallbackId: "callback-id" },
        } as Operation;
      }),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as unknown as Checkpoint;
  });

  it("records the default Callback subtype when no subType is set", async () => {
    const [, callbackId] = await handler()("plain");

    expect(callbackId).toBe("callback-id");
    expect(
      (mockCheckpoint.checkpoint as jest.Mock).mock.calls[0][1],
    ).toMatchObject({
      Action: "START",
      Type: OperationType.CALLBACK,
      SubType: OperationSubType.CALLBACK,
    });
    expect(lifecycleSubTypes()).toEqual([OperationSubType.CALLBACK]);
  });

  it("records the custom subtype on START and in lifecycle metadata", async () => {
    await handler()("job.callback", { subType: "OrderCallback" });

    expect(
      (mockCheckpoint.checkpoint as jest.Mock).mock.calls[0][1],
    ).toMatchObject({
      Action: "START",
      Type: OperationType.CALLBACK,
      SubType: "OrderCallback",
      Name: "job.callback",
    });
    expect(lifecycleSubTypes()).toEqual(["OrderCallback"]);
  });

  it("passes the custom subtype to plugin events", async () => {
    const onOperationStart = jest.fn();

    await handler({ onOperationStart })("job.callback", {
      subType: "OrderCallback",
    });

    expect(onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ subType: "OrderCallback" }),
    );
  });

  it("replays a completed callback whose checkpoint has the same subtype", async () => {
    stepData = {
      Id: hashId(stepId),
      Type: OperationType.CALLBACK,
      Name: "job.callback",
      SubType: "OrderCallback",
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: { CallbackId: "callback-id", Result: "done" },
    } as Operation;
    const onOperationEnd = jest.fn();

    const [result] = await handler({ onOperationEnd })("job.callback", {
      subType: "OrderCallback",
    });

    expect(await result).toBe("done");
    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
    expect(onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ subType: "OrderCallback" }),
    );
    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
  });

  it("terminates as non-deterministic when the replayed subtype differs", async () => {
    stepData = {
      Id: hashId(stepId),
      Type: OperationType.CALLBACK,
      Name: "job.callback",
      SubType: OperationSubType.CALLBACK,
      Status: OperationStatus.STARTED,
      CallbackDetails: { CallbackId: "callback-id" },
    } as Operation;

    void handler()("job.callback", { subType: "OrderCallback" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          'Expected subtype "Callback", but got "OrderCallback"',
        ),
      }),
    );
  });
});
