/**
 * Operation hooks must not block operations, and onInvocationEnd must still see their work
 * finished.
 *
 * The SDK used to await every plugin hook. A slow hook then delayed the next operation. Worse,
 * a hook awaited while no operation was EXECUTING let the invocation suspend before the
 * caller's next line ran, when another operation was waiting. These tests run the real engine
 * with a plugin whose hooks are slower than the termination cooldown.
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
import { DurableInstrumentationPlugin } from "../../types/plugin";
import { CHECKPOINT_TERMINATION_COOLDOWN_MS } from "../constants/constants";
import { Context } from "aws-lambda";

const HOOK_DELAY_MS = CHECKPOINT_TERMINATION_COOLDOWN_MS * 3 + 30;

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

const invoke = (
  handler: (event: unknown, context: DurableContext) => Promise<unknown>,
  plugin: DurableInstrumentationPlugin,
  operations: WireOperation[] = [executionOp],
  context: Context = lambdaContext,
): Promise<unknown> =>
  withDurableExecution(handler, { plugins: [{ createPlugin: () => plugin }] })(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: { Operations: operations, NextMarker: "" },
      },
      client,
    ),
    context,
  );

describe("plugin hooks do not block operations", () => {
  it("runs the next step without waiting for slow operation hooks", async () => {
    const slow = async (): Promise<void> => sleep(HOOK_DELAY_MS);
    const started = Date.now();
    let secondStepAt = 0;

    await invoke(
      async (_event, context) => {
        await context.step("first", async () => "a");
        await context.step("second", async () => {
          secondStepAt = Date.now() - started;
          return "b";
        });
        return "done";
      },
      {
        onOperationStart: slow,
        onOperationAttemptStart: slow,
        onOperationAttemptEnd: slow,
        onOperationEnd: slow,
      },
    );

    // Awaiting four hooks on "first" alone used to take 4 * HOOK_DELAY_MS.
    expect(secondStepAt).toBeLessThan(HOOK_DELAY_MS);
  });

  it("calls onInvocationEnd after the work of earlier hooks settled", async () => {
    const events: string[] = [];

    const response = await invoke(
      async (_event, context) => {
        await context.step("only", async () => "a");
        return "done";
      },
      {
        onOperationEnd: async (info) => {
          await sleep(HOOK_DELAY_MS);
          events.push(`end ${info.name}`);
        },
        onInvocationEnd: async () => {
          events.push("invocation end");
        },
      },
    );

    expect(response).toMatchObject({ Status: InvocationStatus.SUCCEEDED });
    expect(events).toEqual(["end only", "invocation end"]);
  });

  it("runs the caller's next line before suspending when a failed step's end hook is slow", async () => {
    // A failed step is marked COMPLETED before onOperationEnd. Awaiting a slow hook there
    // let the invocation suspend while the pending callback was the only open operation.
    let submitRanBeforeReturn = false;
    let submitRan = false;

    const response = await invoke(
      async (_event, context) => {
        const [callbackPromise] = await context.createCallback("cb");
        await context
          .step(
            "failing",
            async () => {
              throw new Error("expected failure");
            },
            { retryStrategy: () => ({ shouldRetry: false }) },
          )
          .catch(() => undefined);
        await context.step("submit", async () => {
          submitRan = true;
        });
        return await callbackPromise;
      },
      {
        onOperationEnd: async (info) => {
          if (info.name === "failing") await sleep(HOOK_DELAY_MS);
        },
      },
      [executionOp, pendingCallbackOp],
    );
    submitRanBeforeReturn = submitRan;

    expect(submitRanBeforeReturn).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });

  it("runs the caller's next line before suspending when a step's start hook is slow", async () => {
    let submitRan = false;

    const response = await invoke(
      async (_event, context) => {
        const [callbackPromise] = await context.createCallback("cb");
        await context.step("fast", async () => "f");
        await context.step("submit", async () => {
          submitRan = true;
        });
        return await callbackPromise;
      },
      {
        onOperationStart: async (info) => {
          if (info.name === "submit") await sleep(HOOK_DELAY_MS);
        },
      },
      [executionOp, pendingCallbackOp],
    );

    expect(submitRan).toBe(true);
    expect(response).toEqual({ Status: InvocationStatus.PENDING });
  });
  it("bounds the drain by the context's remaining time", async () => {
    // A hook that never settles must not hold the invocation. The engine passes the
    // context's remaining time to the plugin runner, which stops waiting before it.
    const remainingMs = 700;
    const started = Date.now();
    const context = {
      awsRequestId: "request-1",
      getRemainingTimeInMillis: () => remainingMs - (Date.now() - started),
    } as unknown as Context;
    let endCalled = false;

    const response = await Promise.race([
      invoke(
        async (_event, ctx) => {
          await ctx.step("only", async () => "a");
          return "done";
        },
        {
          onOperationEnd: () => new Promise<void>(() => {}),
          onInvocationEnd: async () => {
            endCalled = true;
          },
        },
        [executionOp],
        context,
      ),
      // Fails the test fast if the engine does not bound the drain.
      sleep(remainingMs * 3).then(() => "not bounded"),
    ]);

    expect(response).toMatchObject({ Status: InvocationStatus.SUCCEEDED });
    expect(endCalled).toBe(true);
    expect(Date.now() - started).toBeLessThan(remainingMs);
  });

  it("answers when the context cannot report its remaining time", async () => {
    // A stub context in a unit test, or one from another compute, may lack the method or
    // throw from it. That states no deadline, so the invocation must still answer and
    // every plugin hook must still run.
    const contexts = [
      { awsRequestId: "request-1" },
      {
        awsRequestId: "request-1",
        getRemainingTimeInMillis: () => {
          throw new Error("no deadline");
        },
      },
    ] as unknown as Context[];

    for (const context of contexts) {
      const events: string[] = [];
      const response = await invoke(
        async (_event, ctx) => {
          await ctx.step("only", async () => "a");
          return "done";
        },
        {
          onOperationEnd: async () => {
            await sleep(10);
            events.push("operation end");
          },
          onInvocationEnd: async () => {
            events.push("invocation end");
          },
        },
        [executionOp],
        context,
      );

      expect(response).toMatchObject({ Status: InvocationStatus.SUCCEEDED });
      expect(events).toEqual(["operation end", "invocation end"]);
    }
  });
  it("calls hooks for nested operations in lifecycle order, while their async work may finish in any order", async () => {
    // The guarantee is about when hooks are called, not when their asynchronous work
    // finishes. A slow child end can finish after the parent end.
    const called: string[] = [];
    const finished: string[] = [];

    await invoke(
      async (_event, context) => {
        await context.runInChildContext("parent", (child) =>
          child.step("child", async () => "a"),
        );
        return "done";
      },
      {
        onOperationStart: async (info) => {
          called.push(`${info.name}.start`);
        },
        onOperationEnd: async (info) => {
          called.push(`${info.name}.end`);
          if (info.name === "child") await sleep(HOOK_DELAY_MS);
          finished.push(`${info.name}.end`);
        },
      },
    );

    expect(called).toEqual([
      "parent.start",
      "child.start",
      "child.end",
      "parent.end",
    ]);
    // onInvocationEnd's drain waited for both, and the slow child finished last.
    expect(finished).toEqual(["parent.end", "child.end"]);
  });
});
