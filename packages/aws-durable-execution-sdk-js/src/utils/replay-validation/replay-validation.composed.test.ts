/**
 * Runs the real engine over a checkpoint history that does not match the code replaying
 * it, and asserts the invocation reports the mismatch.
 *
 * This is the end-to-end shape of the fault a customer hits from a step name built at
 * runtime -- `context.step("step-" + Date.now(), ...)` -- which produces a different name
 * on every replay. The unit tests around `validateReplayConsistency` and the termination
 * branch of `withDurableExecution` each cover one half; only running them together shows
 * what the Lambda response actually says, which is the thing that was wrong: the SDK
 * detected the mismatch, built a diagnostic for it, and then answered
 * `{Status: "PENDING"}` with no error and no log line, asking the service to retry
 * something that fails identically on every attempt. See
 * https://github.com/aws/aws-durable-execution-sdk-js/issues/865.
 */

import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../step-id-utils/step-id-utils";
import {
  DurableContext,
  DurableExecutionClient,
  InvocationStatus,
  OperationSubType,
} from "../../types";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";
import { Context } from "aws-lambda";

const EXECUTION_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST";

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

/**
 * The EXECUTION operation every replay state starts with.
 */
const executionOperation = (): WireOperation =>
  ({
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  }) as unknown as WireOperation;

/**
 * Replay state for a single completed step, checkpointed under `checkpointedName`.
 * `hashId("1")` is the id the engine derives for the first operation of the root context,
 * so this is the checkpoint the handler's first `context.step` call will be matched
 * against.
 */
const replayStateFor = (checkpointedName: string): WireOperation[] => [
  executionOperation(),
  {
    Id: hashId("1"),
    Type: OperationType.STEP,
    SubType: OperationSubType.STEP,
    Name: checkpointedName,
    Status: OperationStatus.SUCCEEDED,
    StartTimestamp: new Date().toISOString(),
    StepDetails: { Result: JSON.stringify("checkpointed-result") },
  } as unknown as WireOperation,
];

describe("non-deterministic replay reaches the invocation response", () => {
  const checkpoints: CheckpointDurableExecutionRequest[] = [];

  const client: DurableExecutionClient = {
    getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
      Operations: [],
      NextMarker: undefined,
    }),
    checkpoint: async (
      params: CheckpointDurableExecutionRequest,
    ): Promise<CheckpointDurableExecutionResponse> => {
      checkpoints.push(params);
      return { CheckpointToken: "token-2", NewExecutionState: undefined };
    },
  };

  const invokeAgainst = (
    operations: WireOperation[],
    handler: (event: unknown, context: DurableContext) => Promise<unknown>,
  ): Promise<unknown> =>
    withDurableExecution(handler)(
      new DurableExecutionInvocationInputWithClient(
        {
          DurableExecutionArn: EXECUTION_ARN,
          CheckpointToken: "token-1",
          InitialExecutionState: { Operations: operations, NextMarker: "" },
        },
        client,
      ),
      lambdaContext,
    );

  const invoke = (
    handler: (event: unknown, context: DurableContext) => Promise<unknown>,
    checkpointedName: string,
  ): Promise<unknown> =>
    invokeAgainst(replayStateFor(checkpointedName), handler);

  beforeEach(() => {
    checkpoints.length = 0;
  });

  it("fails the invocation with the diagnostic when a step name changes on replay", async () => {
    const response = await invoke(async (_event, context: DurableContext) => {
      await context.step("step-b", async () => "fresh-result");
      return "done";
    }, "step-a");

    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorType: "NonDeterministicExecutionError",
        ErrorMessage: expect.stringContaining(
          'Expected name "step-a", but got "step-b"',
        ),
      }),
    });

    expect(checkpoints).toEqual([]);
  });

  it("does not run the operation when the mismatched checkpoint is not yet terminal", async () => {
    // The case that makes halting on a mismatch load-bearing rather than tidy. Position 1
    // was checkpointed as a WAIT that is still STARTED, and the handler now replays a STEP
    // there. Nothing about that checkpoint short-circuits the execute path, so reporting
    // the mismatch without stopping leaves the step body to run for real -- an externally
    // visible side effect fired on a replay the SDK has already determined it cannot
    // trust. Termination settles afterwards and the invocation still answers FAILED, so
    // the response alone cannot tell the two behaviours apart; only the side effect can.
    const sideEffect = jest.fn();

    const response = await invokeAgainst(
      [
        executionOperation(),
        {
          Id: hashId("1"),
          Type: OperationType.WAIT,
          SubType: OperationSubType.WAIT,
          Name: "some-wait",
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date().toISOString(),
        } as unknown as WireOperation,
      ],
      async (_event, context: DurableContext) => {
        await context.step("charge-the-card", async () => {
          sideEffect();
          return "charged";
        });
        return "done";
      },
    );

    expect(sideEffect).not.toHaveBeenCalled();
    expect(checkpoints).toEqual([]);
    expect(response).toEqual({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorType: "NonDeterministicExecutionError",
        ErrorMessage: expect.stringContaining("Operation type mismatch"),
      }),
    });
  });

  it("succeeds on the same history when the step name is stable", async () => {
    // The control: the failure above is caused by the name divergence and nothing else
    // about this harness.
    const stepBody = jest.fn();

    const response = await invoke(async (_event, context: DurableContext) => {
      const result = await context.step("step-a", async () => {
        stepBody();
        return "fresh-result";
      });
      return result;
    }, "step-a");

    expect(response).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify("checkpointed-result"),
    });
    expect(stepBody).not.toHaveBeenCalled(); // replayed from the checkpoint
  });
});
