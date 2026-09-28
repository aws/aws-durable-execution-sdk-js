/**
 * A CHECKPOINT_FAILED termination has to throw out of the handler rather than resolve. A
 * 5xx classifies as CheckpointUnrecoverableInvocationError -- the invocation cannot
 * continue but the execution can -- so throwing is what gets it retried, and resolving with
 * any status fails the execution for good.
 *
 * Two callers can raise that termination, and TerminationManager's isTerminated guard means
 * the first one wins. Which one it is decides whether runHandler's `throw result.error` has
 * an error to throw, so there is a test per caller.
 */

import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../step-id-utils/step-id-utils";
import { DurableContext, DurableExecutionClient } from "../../types";
import {
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";
import { CheckpointUnrecoverableInvocationError } from "../../errors/checkpoint-errors/checkpoint-errors";
import { SerdesFailedError } from "../../errors/serdes-errors/serdes-errors";
import { Context } from "aws-lambda";

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

/** A fresh execution: only the EXECUTION operation, so the step runs for the first time. */
const freshExecutionState = (): WireOperation[] => [
  {
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  } as unknown as WireOperation,
];

const workingClient = (): DurableExecutionClient => ({
  getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
    Operations: [],
    NextMarker: undefined,
  }),
  checkpoint: async () => ({
    CheckpointToken: "token-2",
    NewExecutionState: undefined,
  }),
});

/** Rejects every checkpoint with an AWS-shaped 5xx, the shape CheckpointManager reads. */
const failingClient = (): DurableExecutionClient => ({
  ...workingClient(),
  checkpoint: async (): Promise<never> => {
    throw Object.assign(new Error("Service Unavailable"), {
      name: "ServiceException",
      $metadata: { httpStatusCode: 503 },
    });
  },
});

/** Rejects every checkpoint with the stale-token shape emitted by the service. */
const staleCheckpointTokenClient = (): DurableExecutionClient => ({
  ...workingClient(),
  checkpoint: async (): Promise<never> => {
    throw Object.assign(new Error("Invalid checkpoint token"), {
      name: "InvalidParameterValueException",
      $metadata: { httpStatusCode: 400 },
    });
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

describe("CHECKPOINT_FAILED terminations", () => {
  it("rethrows when the transport fails the checkpoint", async () => {
    // CheckpointManager's queue-processing catch has always carried the error, so this
    // path was already correct: a regression guard rather than evidence for any change.
    const invocation = invoke(
      failingClient(),
      async (_event, context: DurableContext) => {
        await context.step("save-the-thing", async () => "done");
        return "finished";
      },
    );

    await expect(invocation).rejects.toThrow(/Checkpoint failed/);
    await expect(invocation).rejects.toMatchObject({
      isUnrecoverableInvocation: true,
    });
  });

  it("rethrows when the transport fails an oversized result's checkpoint", async () => {
    // The oversized result is checkpointed after the handler has won the race against
    // termination. A failed batch is cleared without rejecting its callers, so an await on
    // that checkpoint alone never settled, and the invocation ran until the Lambda timeout.
    const invocation = invoke(failingClient(), async () =>
      "x".repeat(6 * 1024 * 1024 + 1000),
    );

    await expect(
      Promise.race([
        invocation,
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("still pending after 2000 ms")),
            2000,
          ),
        ),
      ]),
    ).rejects.toThrow(/Checkpoint failed/);
    await expect(invocation).rejects.toMatchObject({
      isUnrecoverableInvocation: true,
    });
  });

  it("rethrows stale checkpoint token failures as invocation errors", async () => {
    const invocation = invoke(
      staleCheckpointTokenClient(),
      async (_event, context: DurableContext) => {
        await context.step("save-the-thing", async () => "done");
        return "finished";
      },
    );

    await expect(invocation).rejects.toThrow(/Invalid checkpoint token/);
    await expect(invocation).rejects.toMatchObject({
      isUnrecoverableInvocation: true,
    });
  });

  it("answers a failed batch the same way whatever the result size", async () => {
    // A batch the handler did not await fails after the handler returned. The classified
    // error decides the answer, and the size of the handler's result does not. Before this,
    // a small result answered SUCCEEDED while an oversized one threw.
    const oversized = "x".repeat(6 * 1024 * 1024 + 1000);

    const failAfterFirstCall = (): DurableExecutionClient => {
      let calls = 0;
      return {
        ...workingClient(),
        checkpoint: async () => {
          calls++;
          // Held in flight so the handler returns before the failure lands.
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (calls === 1) {
            throw Object.assign(new Error("Service Unavailable"), {
              name: "ServiceException",
              $metadata: { httpStatusCode: 503 },
            });
          }
          return { CheckpointToken: "token-2", NewExecutionState: undefined };
        },
      };
    };

    const handlerReturningEarly =
      (outcome: () => unknown) =>
      async (_event: unknown, context: DurableContext): Promise<unknown> => {
        void context
          .step("background", async () => "bg")
          .catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return outcome();
      };

    await expect(
      invoke(
        failAfterFirstCall(),
        handlerReturningEarly(() => "small"),
      ),
    ).rejects.toThrow(/Checkpoint failed/);

    await expect(
      invoke(
        failAfterFirstCall(),
        handlerReturningEarly(() => oversized),
      ),
    ).rejects.toThrow(/Checkpoint failed/);
  });

  it("rethrows a serdes failure as SerdesFailedError whatever the result size", async () => {
    // SerdesFailedError is an invocation error, so Lambda retries. A plain Error is not, so
    // the execution would fail for good. The oversized path threw a plain Error because a
    // SERDES_FAILED termination carries no error object.
    const oversized = "x".repeat(6 * 1024 * 1024 + 1000);

    const handlerFailingSerdes =
      (outcome: () => unknown) =>
      async (_event: unknown, context: DurableContext): Promise<unknown> => {
        void context
          .step("background", async () => BigInt(1) as unknown as string)
          .catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return outcome();
      };

    await expect(
      invoke(
        workingClient(),
        handlerFailingSerdes(() => "small"),
      ),
    ).rejects.toThrow(SerdesFailedError);

    await expect(
      invoke(
        workingClient(),
        handlerFailingSerdes(() => oversized),
      ),
    ).rejects.toThrow(SerdesFailedError);
  });

  it("rethrows when step code raises a checkpoint error itself", async () => {
    // Nothing in the checkpoint queue fails here, so CheckpointManager never terminates and
    // step-handler's catch gets there first, via terminateForUnrecoverableError. That call
    // omitted the error, so `throw result.error` threw `undefined`, the outer catch read
    // isUnrecoverableInvocationError(undefined) as false, and the invocation resolved
    // `{Status: FAILED, Error: {ErrorMessage: "Unknown error"}}` -- an execution failed for
    // good where it should have retried, with nothing naming the cause.
    const invocation = invoke(
      workingClient(),
      async (_event, context: DurableContext) => {
        await context.step("boom", async () => {
          throw new CheckpointUnrecoverableInvocationError(
            "thrown by step body",
          );
        });
        return "finished";
      },
    );

    await expect(invocation).rejects.toThrow(/thrown by step body/);
    await expect(invocation).rejects.toMatchObject({
      isUnrecoverableInvocation: true,
    });
  });
});
