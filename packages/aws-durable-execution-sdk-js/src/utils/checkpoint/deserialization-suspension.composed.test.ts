/**
 * An async deserializer must not let the invocation suspend before the code after the
 * operation runs.
 *
 * The checkpoint manager suspends the invocation once no operation is EXECUTING and another
 * operation, here a pending callback, is waiting. Handlers used to mark an operation
 * COMPLETED before deserializing its result. While an async deserializer ran, the callback
 * was the only tracked operation, so the invocation suspended after the termination
 * cooldown. The next step, which in a real workflow submits the callback ID to an external
 * system, never ran in that invocation, and the callback could only time out.
 *
 * Every test here holds a callback pending, runs one operation whose deserializer takes
 * longer than the cooldown, and then runs a "submit" step. The step must run before the
 * invocation returns.
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
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";
import { Serdes } from "../serdes/serdes";
import { CHECKPOINT_TERMINATION_COOLDOWN_MS } from "../constants/constants";
import { Context } from "aws-lambda";

// Comfortably longer than the cooldown, so a premature suspension always wins the race.
const DESERIALIZE_DELAY_MS = CHECKPOINT_TERMINATION_COOLDOWN_MS * 3 + 30;

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

/** A completed record for the second root operation, so it is replayed. */
const completedSecondOp = (op: Partial<WireOperation>): WireOperation =>
  ({
    Id: hashId("2"),
    Status: OperationStatus.SUCCEEDED,
    StartTimestamp: now(),
    ...op,
  }) as unknown as WireOperation;

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

const slowSerdes = <T>(): Serdes<T> => ({
  serialize: async (value) => JSON.stringify(value),
  deserialize: async (data) => {
    await new Promise((resolve) => setTimeout(resolve, DESERIALIZE_DELAY_MS));
    return data === undefined ? undefined : (JSON.parse(data) as T);
  },
});

/**
 * Runs `operationUnderTest` between a pending callback and a "submit" step. Returns the
 * invocation response and whether "submit" ran before the invocation returned.
 */
const run = async (
  operationUnderTest: (context: DurableContext) => Promise<unknown>,
  replayedOps: WireOperation[] = [],
): Promise<{ response: unknown; submitRanBeforeReturn: boolean }> => {
  let submitRan = false;
  const response = await withDurableExecution(
    async (_event: unknown, context: DurableContext) => {
      const [callbackPromise] = await context.createCallback("cb");
      await operationUnderTest(context);
      await context.step("submit", async () => {
        submitRan = true;
      });
      return await callbackPromise;
    },
  )(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: {
          Operations: [executionOp, pendingCallbackOp, ...replayedOps],
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  );
  const submitRanBeforeReturn = submitRan;
  // Let the abandoned deserializer from a premature suspension settle before the next test.
  await new Promise((resolve) => setTimeout(resolve, DESERIALIZE_DELAY_MS));
  return { response, submitRanBeforeReturn };
};

describe("async deserialization with a pending callback", () => {
  it("step: runs the next step before suspending, on the execution path", async () => {
    const { response, submitRanBeforeReturn } = await run((context) =>
      context.step("slow", async () => "value", { serdes: slowSerdes() }),
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("step: runs the next step before suspending, on replay", async () => {
    const { response, submitRanBeforeReturn } = await run(
      (context) =>
        context.step("slow", async () => "value", { serdes: slowSerdes() }),
      [
        completedSecondOp({
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Name: "slow",
          StepDetails: { Result: JSON.stringify("value") },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("waitForCondition: runs the next step before suspending, on the execution path", async () => {
    const { response, submitRanBeforeReturn } = await run((context) =>
      context.waitForCondition("slow", async (state: number) => state + 1, {
        initialState: 0,
        waitStrategy: () => ({ shouldContinue: false }),
        serdes: slowSerdes(),
      }),
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("waitForCondition: runs the next step before suspending, on replay", async () => {
    const { response, submitRanBeforeReturn } = await run(
      (context) =>
        context.waitForCondition("slow", async (state: number) => state + 1, {
          initialState: 0,
          waitStrategy: () => ({ shouldContinue: false }),
          serdes: slowSerdes(),
        }),
      [
        completedSecondOp({
          Type: OperationType.STEP,
          SubType: OperationSubType.WAIT_FOR_CONDITION,
          Name: "slow",
          StepDetails: { Result: JSON.stringify(1) },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("invoke: runs the next step before suspending, on replay", async () => {
    const { response, submitRanBeforeReturn } = await run(
      (context) =>
        context.invoke("slow", "target-function:1", undefined, {
          resultSerdes: slowSerdes(),
        }),
      [
        completedSecondOp({
          Type: OperationType.CHAINED_INVOKE,
          SubType: OperationSubType.CHAINED_INVOKE,
          Name: "slow",
          ChainedInvokeDetails: { Result: JSON.stringify("value") },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("createCallback: runs the next step before suspending, on replay", async () => {
    const { response, submitRanBeforeReturn } = await run(
      async (context) => {
        const [promise] = await context.createCallback("slow", {
          serdes: slowSerdes(),
        });
        return await promise;
      },
      [
        completedSecondOp({
          Type: OperationType.CALLBACK,
          SubType: OperationSubType.CALLBACK,
          Name: "slow",
          CallbackDetails: {
            CallbackId: "completed-callback-id",
            Result: JSON.stringify("value"),
          },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });
});
