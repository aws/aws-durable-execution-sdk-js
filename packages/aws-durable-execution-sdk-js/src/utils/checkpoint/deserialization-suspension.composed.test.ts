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
 *
 * CONTRACT TEST. These cases guard invariants listed in
 * packages/aws-durable-execution-sdk-js/AGENTS.md and docs/adr/0001-operation-tracking-and-plugin-hooks.md.
 * If a change makes a case fail, the change breaks an invariant. Do not edit, skip or delete
 * the case to make the change pass. Change the ADR first.
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
import { SerdesFailedError } from "../../errors/serdes-errors/serdes-errors";
import {
  CHECKPOINT_SIZE_LIMIT_BYTES,
  CHECKPOINT_TERMINATION_COOLDOWN_MS,
} from "../constants/constants";
import { DurableExecutionConfig } from "../../types/durable-execution";
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
  completedOp("2", op);

/** A completed record for the root operation with the given counter id. */
const completedOp = (id: string, op: Partial<WireOperation>): WireOperation =>
  ({
    Id: hashId(id),
    Status: OperationStatus.SUCCEEDED,
    StartTimestamp: now(),
    ...op,
  }) as unknown as WireOperation;

/**
 * A fast step that completes first. Its COMPLETED transition arms the cooldown
 * timer just before the operation under test runs, which is what exposes an
 * untracked deserialization on a replay path.
 */
const completedFastStep = completedOp("2", {
  Type: OperationType.STEP,
  SubType: OperationSubType.STEP,
  Name: "fast",
  StepDetails: { Result: JSON.stringify("fast") },
});

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
  config?: DurableExecutionConfig,
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
    config,
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

  it("runInChildContext: runs the next step before suspending, on the execution path", async () => {
    const { response, submitRanBeforeReturn } = await run((context) =>
      context.runInChildContext(
        "slow",
        (child) => child.step("inner", async () => "value"),
        { serdes: slowSerdes() },
      ),
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runInChildContext: runs the next step before suspending, on replay", async () => {
    const { response, submitRanBeforeReturn } = await run(
      async (context) => {
        await context.step("fast", async () => "fast");
        return await context.runInChildContext(
          "slow",
          (child) => child.step("inner", async () => "value"),
          { serdes: slowSerdes() },
        );
      },
      [
        completedFastStep,
        completedOp("3", {
          Type: OperationType.CONTEXT,
          SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
          Name: "slow",
          ContextDetails: { Result: JSON.stringify("value") },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("map: runs the next step before suspending, on the execution path", async () => {
    const { response, submitRanBeforeReturn } = await run((context) =>
      context.map("slow", [1, 2], async (_child, item: number) => item, {
        itemSerdes: slowSerdes(),
      }),
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("parallel: runs the next step before suspending, on the execution path", async () => {
    const { response, submitRanBeforeReturn } = await run((context) =>
      context.parallel("slow", [async () => "a", async () => "b"], {
        itemSerdes: slowSerdes(),
      }),
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("waitForCallback: runs the next step before suspending, on replay", async () => {
    const { response, submitRanBeforeReturn } = await run(
      async (context) => {
        await context.step("fast", async () => "fast");
        return await context.waitForCallback("slow", async () => {}, {
          serdes: slowSerdes(),
        });
      },
      [
        completedFastStep,
        // The child context stores the raw callback string through the default
        // JSON serdes. waitForCallback then deserializes that string itself.
        completedOp("3", {
          Type: OperationType.CONTEXT,
          SubType: OperationSubType.WAIT_FOR_CALLBACK,
          Name: "slow",
          ContextDetails: {
            Result: JSON.stringify(JSON.stringify("value")),
          },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runInChildContext: runs the next step before suspending, on a large-payload replay", async () => {
    // ReplayChildren means the checkpoint has no result, so replay re-runs the
    // child function and round-trips its value through the serdes.
    const { response, submitRanBeforeReturn } = await run(
      async (context) => {
        await context.step("fast", async () => "fast");
        return await context.runInChildContext("slow", async () => "value", {
          serdes: slowSerdes(),
        });
      },
      [
        completedFastStep,
        completedOp("3", {
          Type: OperationType.CONTEXT,
          SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
          Name: "slow",
          ContextDetails: { Result: "", ReplayChildren: true },
        }),
      ],
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runInChildContext: runs the next step before suspending, for a virtual context", async () => {
    const { response, submitRanBeforeReturn } = await run((context) =>
      context.runInChildContext(
        "slow",
        (child) => child.step("inner", async () => "value"),
        { serdes: slowSerdes(), virtualContext: true },
      ),
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runInChildContext: runs the caller's next step before suspending when the context fails and a plugin hook is slow", async () => {
    // The failure path awaits the plugin's onOperationEnd before the caller
    // sees the error. The context must count as active meanwhile.
    const slowEndHook: DurableExecutionConfig = {
      plugins: [
        {
          createPlugin: () => ({
            onOperationEnd: async (info) => {
              if (info.name === "failing") {
                await new Promise((resolve) =>
                  setTimeout(resolve, DESERIALIZE_DELAY_MS),
                );
              }
            },
          }),
        },
      ],
    };

    const { response, submitRanBeforeReturn } = await run(
      async (context) => {
        await context
          .runInChildContext("failing", async (child) => {
            await child.step("inner", async () => "value");
            throw new Error("expected failure");
          })
          .catch(() => undefined);
      },
      [],
      slowEndHook,
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runInChildContext: marks the context completed when the work after its function fails", async () => {
    // A result over the checkpoint size limit calls summaryGenerator, which
    // throws here. The failure is handled after the context was marked
    // EXECUTING, so it must still end COMPLETED and let the invocation suspend.
    const { response, submitRanBeforeReturn } = await run(async (context) => {
      await context
        .runInChildContext(
          "oversized",
          async () => "x".repeat(CHECKPOINT_SIZE_LIMIT_BYTES + 1),
          {
            summaryGenerator: () => {
              throw new Error("summary failed");
            },
          },
        )
        .catch(() => undefined);
    });

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runInChildContext: runs the caller's next step before suspending when wrapChildContextFn does async work after fn", async () => {
    // A wrapper that awaits fn and then waits. While it waits, no operation inside fn is
    // EXECUTING. So the context itself must already count as EXECUTING.
    const slowWrapperTail: DurableExecutionConfig = {
      plugins: [
        {
          createPlugin: () => ({
            wrapChildContextFn: async (_info, fn) => {
              const value = await fn();
              await new Promise((resolve) =>
                setTimeout(resolve, DESERIALIZE_DELAY_MS),
              );
              return value;
            },
          }),
        },
      ],
    };

    const { response, submitRanBeforeReturn } = await run(
      (context) =>
        context.runInChildContext("wrapped", (child) =>
          child.step("inner", async () => "value"),
        ),
      [],
      slowWrapperTail,
    );

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("reports a deserializer that fails slowly instead of suspending", async () => {
    // Before, the suspension won the race against a failure slower than the
    // cooldown, so the invocation returned PENDING and the failure was lost.
    const failingSerdes: Serdes<string> = {
      serialize: async (value) => JSON.stringify(value),
      deserialize: async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, DESERIALIZE_DELAY_MS),
        );
        throw new Error("storage unavailable");
      },
    };

    await expect(
      run((context) =>
        context.step("slow", async () => "value", { serdes: failingSerdes }),
      ),
    ).rejects.toThrow(SerdesFailedError);
  });
});
