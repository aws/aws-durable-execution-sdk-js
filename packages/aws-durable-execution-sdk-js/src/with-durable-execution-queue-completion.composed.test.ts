import { vi, describe, it, expect, afterEach } from "vitest";
import { withDurableExecution } from "./with-durable-execution";
import { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInput,
  type DurableExecutionClient,
} from "./types";
import { refreshLogConfig } from "./utils/logger/logger";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";

// An in-memory transport. It accepts every checkpoint and never reads more state.
function fakeClient(): DurableExecutionClient {
  return {
    async checkpoint() {
      return { CheckpointToken: "next-token", NewExecutionState: {} };
    },
    async getExecutionState() {
      throw new Error("unexpected state request");
    },
  };
}

describe("withDurableExecution Queue Completion", () => {
  const mockEvent: DurableExecutionInvocationInput = {
    CheckpointToken: "test-token",
    DurableExecutionArn: "test-arn",
    InitialExecutionState: {
      Operations: [
        {
          Id: "execution",
          Type: "EXECUTION",
          Status: "STARTED",
          StartTimestamp: new Date("2026-01-01T00:00:00Z"),
          ExecutionDetails: { InputPayload: "{}" },
        },
      ],
      NextMarker: "",
    },
  };

  const mockContext = {
    awsRequestId: "request",
    getRemainingTimeInMillis: () => 30_000,
  } as Context;

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DURABLE_VERBOSE_MODE;
    refreshLogConfig();
  });

  it("should wait for checkpoint queue completion on successful handler execution", async () => {
    const waitSpy = vi.spyOn(
      CheckpointManager.prototype,
      "waitForQueueCompletion",
    );
    const clearSpy = vi.spyOn(CheckpointManager.prototype, "clearQueue");

    const mockHandler = vi.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler, {
      durableExecutionClient: fakeClient(),
    });

    await expect(wrappedHandler(mockEvent, mockContext)).resolves.toEqual({
      Status: "SUCCEEDED",
      Result: '"success"',
    });

    // waitForQueueCompletion is called in the success path
    expect(waitSpy).toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("should wait for queue completion even on termination", async () => {
    const waitSpy = vi.spyOn(
      CheckpointManager.prototype,
      "waitForQueueCompletion",
    );

    // The wait schedules a timer and terminates the invocation, so termination wins the race
    const wrappedHandler = withDurableExecution(
      async (_event, context) => {
        await context.wait("pause", { seconds: 60 });
        return "success";
      },
      { durableExecutionClient: fakeClient() },
    );

    await expect(wrappedHandler(mockEvent, mockContext)).resolves.toEqual({
      Status: "PENDING",
    });

    expect(waitSpy).toHaveBeenCalledTimes(1);
  });

  it("should handle waitForQueueCompletion errors gracefully", async () => {
    process.env.DURABLE_VERBOSE_MODE = "true";
    refreshLogConfig();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(
      CheckpointManager.prototype,
      "waitForQueueCompletion",
    ).mockRejectedValue(new Error("Queue completion failed"));

    const mockHandler = vi.fn().mockResolvedValue("success");
    const wrappedHandler = withDurableExecution(mockHandler, {
      durableExecutionClient: fakeClient(),
    });

    // Should not throw despite waitForQueueCompletion error
    await expect(wrappedHandler(mockEvent, mockContext)).resolves.toBeDefined();
    expect(debugSpy).toHaveBeenCalledWith(
      "⚠️ Error waiting for checkpoint completion:",
      expect.any(String),
    );
  });
});
