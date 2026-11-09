/**
 * The invocation terminates when its deadline passes.
 *
 * On Lambda Managed Instances an invocation timeout does not stop the code that runs. So the
 * SDK must stop its own work at the deadline: abort the signal of every running step, send no
 * further checkpoint, and start no further operation.
 */
import { describe, it, expect } from "vitest";
import { Context } from "aws-lambda";

import { withDurableExecution } from "./with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "./utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "./utils/step-id-utils/step-id-utils";
import {
  DurableContext,
  DurableExecutionClient,
  InvocationStatus,
} from "./types";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "./types/wire";

const DEADLINE_MS = 40;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A Lambda context whose deadline is `ms` from now. */
const contextWithDeadline = (ms: number): Context => {
  const deadline = Date.now() + ms;
  return {
    awsRequestId: "request-1",
    getRemainingTimeInMillis: () => deadline - Date.now(),
  } as unknown as Context;
};

const executionOp = {
  Id: hashId("execution"),
  Type: OperationType.EXECUTION,
  Status: OperationStatus.STARTED,
  StartTimestamp: new Date().toISOString(),
  ExecutionDetails: { InputPayload: "{}" },
} as unknown as WireOperation;

/** A client that records the action and name of every checkpoint update it receives. */
const recordingClient = (): {
  client: DurableExecutionClient;
  updates: string[];
} => {
  const updates: string[] = [];
  const client: DurableExecutionClient = {
    getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
      Operations: [],
      NextMarker: undefined,
    }),
    checkpoint: async (
      request: CheckpointDurableExecutionRequest,
    ): Promise<CheckpointDurableExecutionResponse> => {
      for (const update of request.Updates ?? []) {
        updates.push(`${update.Action} ${update.Name ?? update.Type}`);
      }
      return { CheckpointToken: "next-token", NewExecutionState: undefined };
    },
  };
  return { client, updates };
};

/**
 * Runs the handler once. Settles with "hung" if the invocation has not answered after
 * `waitMs`, so a test fails instead of timing out.
 */
const invoke = async (
  handler: (event: unknown, context: DurableContext) => Promise<unknown>,
  lambdaContext: Context,
  client: DurableExecutionClient,
  waitMs = 500,
): Promise<unknown> => {
  const invocation = withDurableExecution(handler)(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: { Operations: [executionOp], NextMarker: "" },
      },
      client,
    ),
    lambdaContext,
  ).catch((error: unknown) => error);
  return await Promise.race([invocation, sleep(waitMs).then(() => "hung")]);
};

describe("invocation deadline", () => {
  it("aborts a running step, records no failure for it, and fails the invocation", async () => {
    const { client, updates } = recordingClient();
    let aborted = false;

    const outcome = await invoke(
      async (_event, context) =>
        await context.step("slow", async (ctx) => {
          await new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => {
              aborted = true;
              reject(ctx.signal.reason);
            });
          });
        }),
      contextWithDeadline(DEADLINE_MS),
      client,
    );

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).name).toBe("InvocationDeadlineError");
    expect(aborted).toBe(true);
    await sleep(DEADLINE_MS);
    expect(updates).toEqual(["START slow"]);
  });

  it("does not record or follow a step that ignores the signal", async () => {
    const { client, updates } = recordingClient();
    let afterRan = false;

    const outcome = await invoke(
      async (_event, context) => {
        await context.step("ignores-signal", async () => {
          await sleep(DEADLINE_MS * 3);
        });
        await context.step("after", async () => {
          afterRan = true;
        });
      },
      contextWithDeadline(DEADLINE_MS),
      client,
    );

    expect((outcome as Error).name).toBe("InvocationDeadlineError");
    // Let the step that ignored the signal finish.
    await sleep(DEADLINE_MS * 4);
    expect(afterRan).toBe(false);
    expect(updates).toEqual(["START ignores-signal"]);
  });

  it("sets no deadline when the context reports no finite remaining time", async () => {
    const { client } = recordingClient();
    const lambdaContext = {
      awsRequestId: "request-1",
      getRemainingTimeInMillis: () => Number.NaN,
    } as unknown as Context;

    const outcome = await invoke(
      async (_event, context) => {
        await context.step("work", async () => {
          await sleep(20);
        });
        return "done";
      },
      lambdaContext,
      client,
    );

    expect(outcome).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify("done"),
    });
  });

  it("does not abort the signal after the invocation returned", async () => {
    const { client } = recordingClient();
    let signal: AbortSignal | undefined;

    const outcome = await invoke(
      async (_event, context) => {
        await context.step("quick", async (ctx) => {
          signal = ctx.signal;
        });
        return "done";
      },
      contextWithDeadline(DEADLINE_MS),
      client,
    );

    expect(outcome).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify("done"),
    });
    await sleep(DEADLINE_MS * 2);
    expect(signal?.aborted).toBe(false);
  });
});
