/**
 * A checkpoint response without a `CheckpointToken` has to end the invocation with PENDING.
 *
 * Every checkpoint response carries the token for the next call, so a response without one
 * withdraws this invocation's ability to record anything further. Before this, the manager
 * kept the token it had just spent and sent it again, which the service rejects with
 * `InvalidParameterValueException: Invalid checkpoint token` -- classified as an invocation
 * error, so the invocation ended by throwing. These tests pin the two halves of the answer:
 * the SDK stops calling, and the invocation resolves PENDING rather than throwing or
 * claiming the execution finished.
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
import { InvocationStatus } from "../../types/core";
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

interface RecordingClient {
  client: DurableExecutionClient;
  /**
   * The token each checkpoint call presented, in order. Typed as the request types it --
   * optional -- rather than asserted: what these tests read is which tokens arrived.
   */
  calls: (string | undefined)[];
}

/**
 * A client whose nth checkpoint response omits the token, answering normally before that.
 *
 * `calls` records the token each call presented, which is what shows both that the SDK
 * stopped calling and that it never replayed the spent token.
 */
const clientDroppingTokenOnCall = (dropOn: number): RecordingClient => {
  const calls: (string | undefined)[] = [];

  return {
    calls,
    client: {
      getExecutionState:
        async (): Promise<GetDurableExecutionStateResponse> => ({
          Operations: [],
          NextMarker: undefined,
        }),
      checkpoint: async (
        request,
      ): Promise<CheckpointDurableExecutionResponse> => {
        calls.push(request.CheckpointToken);

        return calls.length >= dropOn
          ? { CheckpointToken: undefined, NewExecutionState: undefined }
          : {
              CheckpointToken: `token-${calls.length + 1}`,
              NewExecutionState: undefined,
            };
      },
    },
  };
};

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

describe("checkpoint response without a CheckpointToken", () => {
  it("suspends with PENDING instead of throwing", async () => {
    const { client } = clientDroppingTokenOnCall(1);

    const result = await invoke(client, async (_event, context) => {
      await context.step("save-the-thing", async () => "done");
      return "finished";
    });

    expect(result).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("stops checkpointing rather than replaying the spent token", async () => {
    // The step's START is the first checkpoint and is answered without a token. Its
    // SUCCEED, and every checkpoint the handler would go on to produce, must not be sent:
    // the only token the SDK holds is the one that call consumed.
    const { client, calls } = clientDroppingTokenOnCall(1);

    await invoke(client, async (_event, context) => {
      await context.step("first", async () => "a");
      await context.step("second", async () => "b");
      return "finished";
    });

    expect(calls).toEqual(["token-1"]);
  });

  it("does not report the execution as finished", async () => {
    // The handler here has nothing left to do after its one step, so a manager that woke
    // the step up from the token-less response would let it return and the invocation would
    // answer SUCCEEDED -- reporting a result the service was never told about.
    const { client } = clientDroppingTokenOnCall(1);

    const result = await invoke(client, async (_event, context) => {
      await context.step("only-step", async () => "done");
      return "finished";
    });

    expect(result).not.toMatchObject({ Status: InvocationStatus.SUCCEEDED });
  });

  it("keeps the checkpoints accepted before the token was withdrawn", async () => {
    // The withdrawal is not a failure of the call that carried it: that checkpoint was
    // accepted, and so was everything before it. Only what the SDK had not yet sent is lost.
    const { client, calls } = clientDroppingTokenOnCall(2);

    const result = await invoke(client, async (_event, context) => {
      await context.step("first", async () => "a");
      await context.step("second", async () => "b");
      await context.step("third", async () => "c");
      return "finished";
    });

    expect(calls).toEqual(["token-1", "token-2"]);
    expect(result).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("does not hold back work that depends on the accepted checkpoint", async () => {
    // "first"'s SUCCEED is the checkpoint answered without a token. It was accepted, but
    // resolving it would let the handler start "second" after the service stopped listening
    // -- work that runs for nothing and then again on the next invocation.
    const { client } = clientDroppingTokenOnCall(2);
    const secondRuns: number[] = [];

    await invoke(client, async (_event, context) => {
      await context.step("first", async () => {
        // A real macrotask, so the SUCCEED goes out in its own checkpoint batch.
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "a";
      });
      await context.step("second", async () => {
        secondRuns.push(1);
        return "b";
      });
      return "finished";
    });

    expect(secondRuns).toEqual([]);
  });

  it("still reports an oversized result that the service accepted", async () => {
    // The oversized-result path checkpoints the execution's own SUCCEED after the handler has
    // returned, and awaits it outside the termination race. A response without a token is to
    // be expected there -- the execution is finished -- so the invocation must go on to
    // report success rather than wait on a checkpoint that will never resolve.
    const oversized = "x".repeat(6 * 1024 * 1024 + 1000);
    const { client, calls } = clientDroppingTokenOnCall(1);

    const result = await invoke(client, async () => oversized);

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ Status: InvocationStatus.SUCCEEDED, Result: "" });
  });
});
