/**
 * StepContext.signal tells a running step that the SDK no longer uses its result.
 *
 * The SDK aborts the signal when the invocation terminates, and when a non-virtual
 * child context that holds the step finishes before the step ends. A map or parallel
 * call that meets its completionConfig is the common case of the second rule.
 *
 * A step that still runs is EXECUTING, so it blocks a suspension until it returns.
 * The tests below use a slow step that stops on the signal. Without the abort, each
 * invocation would run until the slow step ends.
 */
import { describe, it, expect } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import type { Context } from "aws-lambda";

import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import {
  type DurableContext,
  type DurableExecutionClient,
  InvocationStatus,
  NestingType,
  type StepContext,
  type DurableLogger,
} from "../../types";
import {
  type CheckpointDurableExecutionResponse,
  type GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  type WireOperation,
} from "../../types/wire";
import { SerdesFailedError } from "../../errors/serdes-errors/serdes-errors";

// Much longer than any test needs. A test that waits for it has failed.
const SLOW_MS = 10_000;
const TEST_TIMEOUT_MS = SLOW_MS * 3;

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

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

const run = (
  handler: (event: unknown, context: DurableContext) => Promise<unknown>,
): Promise<unknown> =>
  withDurableExecution(handler)(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:abort:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: {
          Operations: [
            {
              Id: hashId("execution"),
              Type: OperationType.EXECUTION,
              Status: OperationStatus.STARTED,
              StartTimestamp: new Date().toISOString(),
              ExecutionDetails: { InputPayload: "{}" },
            } as unknown as WireOperation,
          ],
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  );

/** What a slow step saw. */
type SlowStep = { signal?: AbortSignal; stoppedEarly: boolean };

/** A step function that sleeps for SLOW_MS unless its signal aborts first. */
const slowStep =
  (seen: SlowStep) =>
  async (ctx: StepContext<DurableLogger>): Promise<string> => {
    seen.signal = ctx.signal;
    try {
      await sleep(SLOW_MS, undefined, { signal: ctx.signal });
      return "slow";
    } catch (error) {
      seen.stoppedEarly = true;
      throw error;
    }
  };

describe("StepContext.signal", () => {
  it(
    "aborts a step in a losing parallel branch when completionConfig is met",
    async () => {
      const slow: SlowStep = { stoppedEarly: false };
      const started = Date.now();

      const response = await run(async (_event, context) => {
        await context.parallel(
          "race",
          [
            { name: "fast", func: (c) => c.step("fast", async () => "fast") },
            { name: "slow", func: (c) => c.step("slow", slowStep(slow)) },
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        await context.wait("after", { seconds: 60 });
        return "done";
      });

      expect(response).toEqual({ Status: InvocationStatus.PENDING });
      expect(slow.signal?.aborted).toBe(true);
      expect(slow.stoppedEarly).toBe(true);
      expect(Date.now() - started).toBeLessThan(SLOW_MS / 2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "aborts a step in a losing map item with FLAT nesting",
    async () => {
      const slow: SlowStep = { stoppedEarly: false };

      const response = await run(async (_event, context) => {
        await context.map(
          "race",
          ["fast", "slow"],
          (c, item) =>
            item === "fast"
              ? c.step("fast", async () => "fast")
              : c.step("slow", slowStep(slow)),
          {
            completionConfig: { minSuccessful: 1 },
            nesting: NestingType.FLAT,
          },
        );
        await context.wait("after", { seconds: 60 });
        return "done";
      });

      expect(response).toEqual({ Status: InvocationStatus.PENDING });
      expect(slow.signal?.aborted).toBe(true);
      expect(slow.stoppedEarly).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it("keeps the signal of a running sibling item and of the root context", async () => {
    const signals: Record<string, boolean> = {};

    await run(async (_event, context) => {
      await context.parallel("all", [
        {
          name: "first",
          func: (c) => c.step("first", async () => "first"),
        },
        {
          name: "second",
          func: (c) =>
            c.step("second", async (ctx) => {
              // "first" has finished by now. Its context finishing must not
              // abort this sibling.
              await sleep(50);
              signals.second = ctx.signal.aborted;
            }),
        },
      ]);
      await context.step("root", async (ctx) => {
        // "all" has finished, but it is a child of the root context, not its parent.
        signals.root = ctx.signal.aborted;
      });
      return "done";
    });

    expect(signals).toEqual({ second: false, root: false });
  });

  it(
    "aborts a step that still runs when its child context throws",
    async () => {
      const slow: SlowStep = { stoppedEarly: false };

      await run(async (_event, context) => {
        await context
          .runInChildContext("child", async (c) => {
            void c.step("slow", slowStep(slow)).catch(() => {});
            throw new Error("child failed");
          })
          .catch(() => {});
        return "done";
      });

      expect(slow.signal?.aborted).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "aborts a running step when the invocation terminates",
    async () => {
      const slow: SlowStep = { stoppedEarly: false };
      const started = Date.now();

      // A serdes failure terminates the invocation and fails it with a throw.
      const invocation = run(async (_event, context) => {
        await context.parallel("fault", [
          { name: "slow", func: (c) => c.step("slow", slowStep(slow)) },
          {
            name: "bad",
            func: (c) =>
              c.step("bad", async () => "value", {
                serdes: {
                  serialize: async () => {
                    throw new Error("cannot serialize");
                  },
                  deserialize: async () => undefined,
                },
              }),
          },
        ]);
        return "done";
      });

      await expect(invocation).rejects.toThrow(SerdesFailedError);
      expect(slow.signal?.aborted).toBe(true);
      expect(Date.now() - started).toBeLessThan(SLOW_MS / 2);
    },
    TEST_TIMEOUT_MS,
  );
});
