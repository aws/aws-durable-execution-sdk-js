/**
 * The handler-wins path: the customer handler returns normally while a checkpoint
 * is still queued, and that checkpoint's batch then fails during the drain.
 *
 * run-in-child-context-handler does not await its terminal SUCCEED checkpoint, so
 * `await context.runInChildContext(...)` hands the value back to the handler with
 * that checkpoint still in the queue. The handler returns, wins the race against
 * the termination promise, and only then does the drain fail. Nothing is left
 * awaiting the termination promise at that point, so before the fix this reported
 * SUCCEEDED for state that was never persisted -- and because a result was being
 * returned, there was no subsequent invocation to retry it.
 *
 * Real withDurableExecution and real CheckpointManager; only the transport is
 * faked, and it fails only after the handler's work is done.
 */

import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../step-id-utils/step-id-utils";
import { DurableContext, DurableExecutionClient } from "../../types";
import {
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";
import { Context } from "aws-lambda";

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

/** A fresh execution: only the EXECUTION operation, so the child runs for the first time. */
const freshExecutionState = (): WireOperation[] => [
  {
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  } as unknown as WireOperation,
];

/**
 * Succeeds until `failFrom` is flipped, then rejects with an AWS-shaped 5xx --
 * a transient backend error, classified as CheckpointUnrecoverableInvocationError.
 */
const clientFailingAfterHandler = (
  shouldFail: () => boolean,
  onCall: () => void,
): DurableExecutionClient => ({
  getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
    Operations: [],
    NextMarker: undefined,
  }),
  checkpoint: async (): Promise<CheckpointDurableExecutionResponse> => {
    onCall();

    if (shouldFail()) {
      throw Object.assign(new Error("Service Unavailable"), {
        name: "ServiceException",
        $metadata: { httpStatusCode: 503 },
      });
    }

    return {
      CheckpointToken: "token-2",
      NewExecutionState: undefined,
    } as unknown as CheckpointDurableExecutionResponse;
  },
});

const invoke = (
  client: DurableExecutionClient,
  handler: (event: unknown, context: DurableContext) => Promise<unknown>,
): Promise<unknown> =>
  withDurableExecution(handler)(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: {
          Operations: freshExecutionState(),
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  );

describe("checkpoint failure after the handler resolves", () => {
  it("throws instead of reporting SUCCEEDED for a discarded checkpoint", async () => {
    let handlerDone = false;
    let checkpointCalls = 0;

    const client = clientFailingAfterHandler(
      () => handlerDone,
      () => {
        checkpointCalls += 1;
      },
    );

    const invocation = invoke(
      client,
      async (_event, context: DurableContext) => {
        // The child context's terminal SUCCEED checkpoint is enqueued but not
        // awaited, so it is still outstanding when this handler returns.
        await context.runInChildContext("child", async () => "child-done");

        handlerDone = true;
        return "finished";
      },
    );

    // Before the fix this resolved {"Status":"SUCCEEDED","Result":"\"finished\""}.
    await expect(invocation).rejects.toThrow(/Checkpoint failed/);
    await expect(invocation).rejects.toMatchObject({
      isUnrecoverableInvocation: true,
    });

    // Guards the setup rather than the fix: if the transport were never reached
    // after the handler finished, the test would pass for the wrong reason.
    expect(checkpointCalls).toBeGreaterThan(0);
  });

  it("still reports SUCCEEDED when the drain succeeds", async () => {
    let checkpointCalls = 0;

    const client = clientFailingAfterHandler(
      () => false,
      () => {
        checkpointCalls += 1;
      },
    );

    const result = await invoke(
      client,
      async (_event, context: DurableContext) => {
        await context.runInChildContext("child", async () => "child-done");
        return "finished";
      },
    );

    expect(result).toMatchObject({ Status: "SUCCEEDED" });
    expect(checkpointCalls).toBeGreaterThan(0);
  });
});
