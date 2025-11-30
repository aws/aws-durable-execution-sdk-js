import { createWaitHandler } from "./wait-handler";
import { ExecutionContext } from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

jest.mock("../../utils/logger/logger");

describe("Wait Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  let stepIdCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    stepIdCounter = 0;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      durableExecutionArn: "test-arn",
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForRetryTimer: jest.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;
  });

  it("should execute wait logic in phase 1 without awaiting", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const waitPromise = waitHandler({ seconds: 5 });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(waitPromise).toBeInstanceOf(DurablePromise);
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();
    expect(mockContext.getStepData).toHaveBeenCalled();
  });

  it("should execute wait logic when .then is called", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const waitPromise = waitHandler({ seconds: 5 });
    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(false);

    waitPromise.then(() => {}).catch(() => {});

    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(true);
  });

  it("should create wait with name parameter", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const waitPromise = waitHandler("test-wait", { seconds: 5 });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(waitPromise).toBeInstanceOf(DurablePromise);
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();
  });
});
