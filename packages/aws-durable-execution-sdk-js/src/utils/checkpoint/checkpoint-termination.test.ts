import {
  createCheckpoint,
  deleteCheckpoint,
  setCheckpointTerminating,
} from "./checkpoint";
import { ExecutionContext } from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import * as logger from "../logger/logger";

describe("Checkpoint Termination Flag", () => {
  let mockContext: ExecutionContext;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    deleteCheckpoint();
    logSpy = jest.spyOn(logger, "log").mockImplementation();

    mockContext = {
      durableExecutionArn: "test-arn",
      state: {
        checkpoint: jest.fn().mockResolvedValue({
          CheckpointToken: "new-token",
          NewExecutionState: { Operations: [] },
        }),
      },
      _stepData: {},
      terminationManager: new TerminationManager(),
    } as unknown as ExecutionContext;
  });

  afterEach(() => {
    deleteCheckpoint();
    logSpy.mockRestore();
  });

  test("should skip checkpoint when termination flag is set", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    setCheckpointTerminating();

    await checkpoint("test-step", {
      Action: "START",
      Type: "STEP",
    });

    expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
  });

  test("should skip forceCheckpoint when termination flag is set", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    setCheckpointTerminating();

    await checkpoint.force();

    expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
  });

  test("should allow checkpoint before termination flag is set", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    await checkpoint("test-step", {
      Action: "START",
      Type: "STEP",
    });

    // Wait for async processing
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockContext.state.checkpoint).toHaveBeenCalled();
  });

  test("should prevent new checkpoints after setTerminating is called", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    // First checkpoint should work
    await checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockContext.state.checkpoint).toHaveBeenCalledTimes(1);

    // Set termination flag
    setCheckpointTerminating();

    // Second checkpoint should be skipped
    await checkpoint("step-2", {
      Action: "START",
      Type: "STEP",
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockContext.state.checkpoint).toHaveBeenCalledTimes(1);
  });

  test("should call setCheckpointTerminating through checkpoint.setTerminating", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    checkpoint.setTerminating();

    await checkpoint("test-step", {
      Action: "START",
      Type: "STEP",
    });

    expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
  });

  test("should log when checkpoint is skipped due to termination", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    setCheckpointTerminating();

    await checkpoint("test-step", {
      Action: "START",
      Type: "STEP",
    });

    expect(logSpy).toHaveBeenCalledWith(
      "⚠️",
      "Checkpoint skipped - termination in progress:",
      { stepId: "test-step" },
    );
  });

  test("should log when force checkpoint is skipped due to termination", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    setCheckpointTerminating();

    await checkpoint.force();

    expect(logSpy).toHaveBeenCalledWith(
      "⚠️",
      "Force checkpoint skipped - termination in progress",
    );
  });
});
