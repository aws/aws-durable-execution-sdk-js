/**
 * An operation that the handler starts after the invocation terminated must not run.
 *
 * Termination ends the invocation: the wrapper answers, and the checkpoint manager accepts no
 * further checkpoint. The handler's own code can still run after that, for example when it
 * awaits a timer or I/O outside any operation. On standard Lambda the execution environment
 * freezes, so that code never resumes. On Lambda Managed Instances it does not freeze. A step
 * that the handler starts then would run its function, and the service would never learn of it.
 *
 * Every test here holds a callback pending, waits outside any operation until the invocation
 * suspends, and then starts one more operation.
 */
import { describe, it, expect } from "vitest";
import { Context } from "aws-lambda";

import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import {
  DurableContext,
  DurableExecutionClient,
  InvocationStatus,
  OperationSubType,
} from "../../types";
import {
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";
import { CHECKPOINT_TERMINATION_COOLDOWN_MS } from "../../utils/constants/constants";

// Longer than the cooldown, so the invocation suspends while the handler waits.
const WAIT_OUTSIDE_OPERATION_MS = CHECKPOINT_TERMINATION_COOLDOWN_MS * 3 + 30;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

const now = (): string => new Date().toISOString();

const executionOp = {
  Id: hashId("execution"),
  Type: OperationType.EXECUTION,
  Status: OperationStatus.STARTED,
  StartTimestamp: now(),
  ExecutionDetails: { InputPayload: "{}" },
} as unknown as WireOperation;

/** The first root operation: a callback that was created and never completes. */
const pendingCallbackOp = {
  Id: hashId("1"),
  Type: OperationType.CALLBACK,
  SubType: OperationSubType.CALLBACK,
  Name: "cb",
  Status: OperationStatus.STARTED,
  StartTimestamp: now(),
  CallbackDetails: { CallbackId: "callback-id" },
} as unknown as WireOperation;

const client: DurableExecutionClient = {
  getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
    Operations: [],
    NextMarker: undefined,
  }),
  checkpoint: async (): Promise<CheckpointDurableExecutionResponse> => ({
    CheckpointToken: "next-token",
    NewExecutionState: undefined,
  }),
};

/**
 * Runs `lateOperation` after the invocation suspended. Returns the invocation response and
 * whether the late operation ran its function or settled.
 */
const run = async (
  lateOperation: (context: DurableContext, markRan: () => void) => unknown,
): Promise<{ response: unknown; ran: boolean; settled: boolean }> => {
  let ran = false;
  let settled = false;
  const response = await withDurableExecution(
    async (_event: unknown, context: DurableContext) => {
      const [callbackPromise] = await context.createCallback("cb");
      // Promise.all awaits the callback at once, so the callback is waiting while the
      // other branch sleeps outside any operation. The invocation then suspends.
      const [result] = await Promise.all([
        callbackPromise,
        (async (): Promise<void> => {
          await sleep(WAIT_OUTSIDE_OPERATION_MS);
          await lateOperation(context, () => {
            ran = true;
          });
          settled = true;
        })(),
      ]);
      return result;
    },
  )(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: {
          Operations: [executionOp, pendingCallbackOp],
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  );
  // The handler is still running. Give it time to start the late operation.
  await sleep(WAIT_OUTSIDE_OPERATION_MS * 2);
  return { response, ran, settled };
};

describe("an operation started after the invocation terminated", () => {
  it("step: does not run the step function", async () => {
    const { response, ran, settled } = await run((context, markRan) =>
      context.step("late", async () => {
        markRan();
      }),
    );

    expect(response).toEqual({ Status: InvocationStatus.PENDING });
    expect(ran).toBe(false);
    expect(settled).toBe(false);
  });

  it("runInChildContext: does not run the child function", async () => {
    const { response, ran, settled } = await run((context, markRan) =>
      context.runInChildContext("late", async () => {
        markRan();
      }),
    );

    expect(response).toEqual({ Status: InvocationStatus.PENDING });
    expect(ran).toBe(false);
    expect(settled).toBe(false);
  });
});
