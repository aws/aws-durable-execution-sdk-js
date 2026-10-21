import { createHook } from "node:async_hooks";
import type { Context } from "aws-lambda";
import { withDurableExecution } from "./with-durable-execution";
import type {
  DurableContext,
  DurableExecutionClient,
  DurableExecutionHandler,
} from "./types";
import { InvocationStatus } from "./types/core";
import type {
  DurableInstrumentationPlugin,
  InvocationEndInfo,
} from "./types/plugin";
import type {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  Operation,
  OperationUpdate,
} from "./types/wire";
import { OperationStatus, OperationType } from "./types/wire";
import { InvocationDeadlineError } from "./utils/invocation-lifecycle/invocation-lifecycle";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function recorder() {
  const operations = new Map<string, Operation>();
  const calls: CheckpointDurableExecutionRequest[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const checkpoint = jest.fn<
    ReturnType<DurableExecutionClient["checkpoint"]>,
    Parameters<DurableExecutionClient["checkpoint"]>
  >(async (request, _logger, options) => {
    calls.push(request);
    signals.push(options?.abortSignal);
    const updated = (request.Updates ?? []).map((update: OperationUpdate) => {
      const prior = operations.get(update.Id!);
      const op: Operation = {
        ...prior,
        Id: update.Id,
        Type: update.Type,
        Name: update.Name,
        ParentId: update.ParentId,
        SubType: update.SubType,
        StartTimestamp: prior?.StartTimestamp ?? new Date(),
        Status:
          update.Action === "SUCCEED"
            ? OperationStatus.SUCCEEDED
            : update.Action === "FAIL"
              ? OperationStatus.FAILED
              : OperationStatus.STARTED,
        ...(update.Type === OperationType.STEP && {
          StepDetails: { Result: update.Payload, Error: update.Error },
        }),
        ...(update.Type === OperationType.CONTEXT && {
          ContextDetails: { Result: update.Payload, Error: update.Error },
        }),
        ...(update.Type === OperationType.WAIT && {
          WaitDetails: { ScheduledEndTimestamp: new Date(Date.now() + 60_000) },
        }),
      };
      operations.set(update.Id!, op);
      return op;
    });
    return {
      CheckpointToken: `token-${calls.length}`,
      NewExecutionState: { Operations: updated },
    };
  });
  const client: DurableExecutionClient = {
    getExecutionState: jest.fn(async () => ({ Operations: [] })),
    checkpoint,
  };
  return { client, checkpoint, operations, calls, signals };
}

function input(operations: Operation[] = [], arn = "lifecycle") {
  return {
    DurableExecutionArn: `arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST/durable-execution/${arn}/id`,
    CheckpointToken: "token-0",
    InitialExecutionState: {
      Operations: [
        {
          Id: "execution",
          Type: OperationType.EXECUTION,
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date(),
          ExecutionDetails: { InputPayload: "{}" },
        },
        ...operations,
      ],
    },
  };
}

function runtime(remaining = Infinity): Context {
  const deadline = performance.now() + remaining;
  return {
    awsRequestId: "request",
    getRemainingTimeInMillis: () => deadline - performance.now(),
  } as Context;
}

async function tickUntil(condition: () => boolean) {
  for (let i = 0; i < 30 && !condition(); i++)
    await jest.advanceTimersByTimeAsync(1);
  expect(condition()).toBe(true);
}

describe("invocation-owned lifecycle through the public wrapper", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("does not charge a virtual durable-clock jump to a live invocation", async () => {
    const store = recorder();
    const release = deferred();
    const started = jest.fn();
    const handler = withDurableExecution(
      async (_event, ctx) =>
        ctx.step("live", async () => {
          started();
          await release.promise;
          return "done";
        }),
      { durableExecutionClient: store.client },
    );
    // The local runner reports this fixed budget while skipTime advances the
    // global fake clock to a durable wait's end. Physical runtime has not elapsed.
    const remaining = jest.fn(() => 900_000);
    const context: Context = {
      ...runtime(),
      awsRequestId: "virtual-clock",
      getRemainingTimeInMillis: remaining,
    };
    const result = handler(input(), context);
    await tickUntil(() => started.mock.calls.length === 1);
    await jest.advanceTimersByTimeAsync(1);
    const readsBeforeJump = remaining.mock.calls.length;
    await jest.advanceTimersByTimeAsync(86_400_000);
    expect(remaining).toHaveBeenCalledTimes(readsBeforeJump);
    release.resolve();
    await jest.advanceTimersByTimeAsync(10);
    expect(await result).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: '"done"',
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("starts admitted work before its DurablePromise is awaited", async () => {
    const store = recorder();
    const entered = deferred();
    const body = jest.fn(async () => {
      entered.resolve();
      return "done";
    });
    const handler = withDurableExecution(
      async (_event, ctx) => {
        const pending = ctx.step("eager", body);
        expect(pending.isExecuted).toBe(false);
        await entered.promise;
        return pending;
      },
      { durableExecutionClient: store.client },
    );
    const result = handler(input(), runtime());
    await jest.advanceTimersByTimeAsync(10);
    expect(await result).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: '"done"',
    });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("retains JavaScript step callbacks that return a plain value", async () => {
    const store = recorder();
    // JavaScript callers can return a value even though the TypeScript StepFunc
    // contract asks for a Promise; the existing runtime normalizes it with await.
    const callback = (() => 42) as unknown as () => Promise<number>;
    const result = withDurableExecution(
      async (_event, ctx) => ctx.step("sync", callback),
      { durableExecutionClient: store.client },
    )(input(), runtime());
    await jest.advanceTimersByTimeAsync(10);
    expect(await result).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: "42",
    });
  });

  it.each(["throw", "reject", "hang"] as const)(
    "does not await deadline cleanup or call End for an unstarted plugin (%s)",
    async (failure) => {
      const store = recorder();
      let remaining = 1000;
      const cleanup = jest.fn((): Promise<void> => {
        if (failure === "throw") throw new Error("sync cleanup failure");
        if (failure === "reject")
          return Promise.reject(new Error("async cleanup failure"));
        return new Promise(() => {});
      });
      const laterStart = jest.fn();
      const laterEnd = jest.fn();
      const body = jest.fn(async () => "forbidden");
      const handler = withDurableExecution(body, {
        durableExecutionClient: store.client,
        plugins: [
          {
            createPlugin: () => ({
              onInvocationStart: async () => {
                remaining = 0;
              },
              onInvocationEnd: cleanup,
            }),
          },
          {
            createPlugin: () => ({
              onInvocationStart: laterStart,
              onInvocationEnd: laterEnd,
            }),
          },
        ],
      });
      await expect(
        handler(input(), {
          ...runtime(),
          getRemainingTimeInMillis: () => remaining,
        }),
      ).rejects.toBeInstanceOf(InvocationDeadlineError);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ status: "RETRYING" }),
      );
      expect(laterStart).not.toHaveBeenCalled();
      expect(laterEnd).not.toHaveBeenCalled();
      expect(body).not.toHaveBeenCalled();
      expect(store.checkpoint).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(10);
      expect(cleanup).toHaveBeenCalledTimes(1);
    },
  );

  it("finishes only the remaining End hooks if expiry interrupts their dispatch", async () => {
    const store = recorder();
    store.checkpoint.mockResolvedValue({
      CheckpointToken: undefined,
      NewExecutionState: undefined,
    });
    let remaining = 1000;
    const firstEnd = jest.fn(async () => {
      remaining = 0;
    });
    const secondEnd = jest.fn();
    const handler = withDurableExecution(
      async (_event, ctx) => ctx.step("withdraw-token", async () => "accepted"),
      {
        durableExecutionClient: store.client,
        plugins: [
          { createPlugin: () => ({ onInvocationEnd: firstEnd }) },
          { createPlugin: () => ({ onInvocationEnd: secondEnd }) },
        ],
      },
    );
    const result = handler(input(), {
      ...runtime(),
      getRemainingTimeInMillis: () => remaining,
    });
    await jest.advanceTimersByTimeAsync(10);
    expect(await result).toEqual({ Status: InvocationStatus.PENDING });
    expect(firstEnd).toHaveBeenCalledTimes(1);
    expect(secondEnd).toHaveBeenCalledTimes(1);
    for (const end of [firstEnd, secondEnd]) {
      expect(end).toHaveBeenCalledWith(
        expect.objectContaining({ status: "PENDING" }),
      );
    }
  });

  it.each(["success", "failure"] as const)(
    "preserves selected terminal %s while cleanup exceeds the deadline, including replay",
    async (outcome) => {
      const store = recorder();
      const completed = jest.fn(async () => ({ value: "saved" }));
      const customerError = new Error("selected customer failure");
      let remaining = 1000;
      let release = deferred();
      let captured!: DurableContext;
      const firstEnd = jest.fn(async (_info: InvocationEndInfo) => {
        remaining = 0;
        await release.promise;
      });
      const secondEnd = jest.fn();
      const handler = withDurableExecution(
        async (_event, ctx) => {
          captured = ctx;
          const value = await ctx.step("completed", completed);
          if (outcome === "failure") throw customerError;
          return value;
        },
        {
          durableExecutionClient: store.client,
          plugins: [
            { createPlugin: () => ({ onInvocationEnd: firstEnd }) },
            { createPlugin: () => ({ onInvocationEnd: secondEnd }) },
          ],
        },
      );

      for (let invocation = 0; invocation < 2; invocation++) {
        remaining = 1000;
        release = deferred();
        const result = handler(input([...store.operations.values()]), {
          ...runtime(),
          awsRequestId: `cleanup-${invocation}`,
          getRemainingTimeInMillis: () => remaining,
        }).then(
          (value) => value,
          (error: unknown) => error,
        );
        try {
          await tickUntil(() => firstEnd.mock.calls.length === invocation + 1);
          if (outcome === "success") {
            expect(await result).toEqual({
              Status: InvocationStatus.SUCCEEDED,
              Result: '{"value":"saved"}',
            });
          } else {
            expect(await result).toMatchObject({
              Status: InvocationStatus.FAILED,
              Error: {
                ErrorType: "Error",
                ErrorMessage: "selected customer failure",
              },
            });
          }
          for (const ended of [firstEnd, secondEnd]) {
            expect(ended).toHaveBeenCalledTimes(invocation + 1);
            const info = ended.mock.calls[invocation][0] as InvocationEndInfo;
            expect(info.status).toBe(
              outcome === "success" ? "SUCCEEDED" : "FAILED",
            );
            expect(info.executionError).toBe(
              outcome === "failure" ? customerError : undefined,
            );
            expect(info.executionResult).toEqual(
              outcome === "success" ? { value: "saved" } : undefined,
            );
          }
          const callsAtReturn = store.calls.length;
          const lateBody = jest.fn(async () => "forbidden");
          void captured
            .step("after-cleanup-expiry", lateBody)
            .then(() => undefined);
          release.resolve();
          await jest.advanceTimersByTimeAsync(10);
          expect(lateBody).not.toHaveBeenCalled();
          expect(store.calls).toHaveLength(callsAtReturn);
          expect(firstEnd).toHaveBeenCalledTimes(invocation + 1);
          expect(secondEnd).toHaveBeenCalledTimes(invocation + 1);
        } finally {
          release.resolve();
          await jest.advanceTimersByTimeAsync(10);
          await result;
        }
      }
      expect(completed).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("does not select a terminal response when serialization consumes the remaining budget", async () => {
    const store = recorder();
    let remaining = 1000;
    const ended = jest.fn();
    const result = withDurableExecution(
      async () => ({
        toJSON() {
          remaining = 0;
          return "too late";
        },
      }),
      {
        durableExecutionClient: store.client,
        plugins: [{ createPlugin: () => ({ onInvocationEnd: ended }) }],
      },
    )(input(), { ...runtime(), getRemainingTimeInMillis: () => remaining });

    await expect(result).rejects.toBeInstanceOf(InvocationDeadlineError);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RETRYING" }),
    );
    expect(store.checkpoint).not.toHaveBeenCalled();
  });

  it("preserves a prepared configuration failure when cleanup expires", async () => {
    const store = recorder();
    let remaining = 1000;
    const release = deferred();
    const firstEnd = jest.fn(async (_info: InvocationEndInfo) => {
      remaining = 0;
      await release.promise;
    });
    const secondEnd = jest.fn();
    const body = jest.fn(async () => "must not run");
    const result = withDurableExecution(body, {
      durableExecutionClient: store.client,
      pluginsConfig: { childOperationsDepth: -1 },
      plugins: [
        { createPlugin: () => ({ onInvocationEnd: firstEnd }) },
        { createPlugin: () => ({ onInvocationEnd: secondEnd }) },
      ],
    })(input(), {
      ...runtime(),
      getRemainingTimeInMillis: () => remaining,
    }).then(
      (value) => value,
      (error: unknown) => error,
    );
    try {
      await tickUntil(() => firstEnd.mock.calls.length === 1);
      const selectedError = firstEnd.mock.calls[0][0].executionError;
      expect(await result).toMatchObject({
        Status: InvocationStatus.FAILED,
        Error: { ErrorType: "Error", ErrorMessage: selectedError?.message },
      });
      expect(secondEnd).toHaveBeenCalledTimes(1);
      expect(secondEnd.mock.calls[0][0].status).toBe("FAILED");
      expect(secondEnd.mock.calls[0][0].executionError).toBe(selectedError);
      expect(body).not.toHaveBeenCalled();
      expect(store.checkpoint).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await jest.advanceTimersByTimeAsync(10);
      await result;
    }
    expect(firstEnd).toHaveBeenCalledTimes(1);
    expect(secondEnd).toHaveBeenCalledTimes(1);
  });

  it("does not start the handler or send a checkpoint with an expired deadline", async () => {
    const store = recorder();
    const body = jest.fn(async () => "done");
    await expect(
      withDurableExecution(body, { durableExecutionClient: store.client })(
        input(),
        runtime(0),
      ),
    ).rejects.toBeInstanceOf(InvocationDeadlineError);
    expect(body).not.toHaveBeenCalled();
    expect(store.checkpoint).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("interrupts a held body without checkpointing failure, then replays stored success and failure", async () => {
    const store = recorder();
    const release = deferred();
    const success = jest.fn(async () => "stored");
    const failure = jest.fn(async () => {
      throw new Error("stored failure");
    });
    const slow = jest.fn(async () => {
      await release.promise;
      return "late";
    });
    const next = jest.fn(async () => "next");
    const failures: string[] = [];
    const body: DurableExecutionHandler = async (_event, ctx) => {
      const value = await ctx.step("success", success);
      try {
        await ctx.step("failure", failure, {
          retryStrategy: () => ({ shouldRetry: false }),
        });
      } catch (error) {
        failures.push((error as Error).message);
      }
      await ctx.step("slow", slow);
      return [value, await ctx.step("next", next)];
    };
    const handler = withDurableExecution(body, {
      durableExecutionClient: store.client,
    });
    const expired = handler(input(), runtime(1000)).then(
      () => undefined,
      (error: unknown) => error,
    );
    await tickUntil(() => slow.mock.calls.length === 1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await expired).toBeInstanceOf(InvocationDeadlineError);
    expect(next).not.toHaveBeenCalled();
    const count = store.calls.length;
    release.resolve();
    await jest.advanceTimersByTimeAsync(10);
    expect(store.calls).toHaveLength(count);
    expect(
      store.operations.get(
        [...store.operations.values()].find((op) => op.Name === "slow")!.Id!,
      )?.Status,
    ).toBe(OperationStatus.STARTED);

    const replay = handler(input([...store.operations.values()]), runtime());
    await tickUntil(() => next.mock.calls.length === 1);
    await jest.advanceTimersByTimeAsync(10);
    expect(await replay).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: '["stored","next"]',
    });
    expect(success).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(2);
    expect(failures[1]).toBe(failures[0]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not checkpoint a losing step or admit new work after root success", async () => {
    const store = recorder();
    const release = deferred();
    const started = deferred();
    let captured!: DurableContext;
    const sideEffect = jest.fn();
    const lateBody = jest.fn(async () => "forbidden");
    const handler = withDurableExecution(
      async (_event, ctx) => {
        captured = ctx;
        void ctx
          .step("loser", async () => {
            started.resolve();
            await release.promise;
            sideEffect();
          })
          .then(() => undefined);
        await started.promise;
        return "winner";
      },
      { durableExecutionClient: store.client },
    );
    const result = handler(input(), runtime());
    await jest.advanceTimersByTimeAsync(10);
    expect(await result).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: '"winner"',
    });
    const count = store.calls.length;
    void captured.step("post-return", lateBody).then(() => undefined);
    release.resolve();
    await jest.advanceTimersByTimeAsync(10);
    // Arbitrary already-running user I/O may finish; the SDK does not claim to cancel it.
    expect(sideEffect).toHaveBeenCalledTimes(1);
    expect(lateBody).not.toHaveBeenCalled();
    expect(store.calls).toHaveLength(count);
    expect(
      store.calls
        .flatMap((call) => call.Updates ?? [])
        .some((update) => update.Action === "SUCCEED"),
    ).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["step", "child", "condition"] as const)(
    "does not enter a %s callback deferred by a plugin until after return",
    async (kind) => {
      const store = recorder();
      const entered = deferred();
      const release = deferred();
      const callback = jest.fn(async () => 1);
      const plugin: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: async (_info, fn) => {
          entered.resolve();
          await release.promise;
          return fn();
        },
        wrapChildContextFn: async (_info, fn) => {
          entered.resolve();
          await release.promise;
          return fn();
        },
      };
      const handler = withDurableExecution(
        async (_event, ctx) => {
          const work =
            kind === "step"
              ? ctx.step("deferred", callback)
              : kind === "child"
                ? ctx.runInChildContext("deferred", callback)
                : ctx.waitForCondition("deferred", callback, {
                    initialState: 0,
                    waitStrategy: () => ({ shouldContinue: false }),
                  });
          void work.then(() => undefined);
          await entered.promise;
          return "done";
        },
        {
          durableExecutionClient: store.client,
          plugins: [{ createPlugin: () => plugin }],
        },
      );
      const result = handler(input(), runtime());
      await jest.advanceTimersByTimeAsync(10);
      expect((await result).Status).toBe(InvocationStatus.SUCCEEDED);
      const count = store.calls.length;
      release.resolve();
      await jest.advanceTimersByTimeAsync(10);
      expect(callback).not.toHaveBeenCalled();
      expect(store.calls).toHaveLength(count);
    },
  );

  it("bounds an uncooperative checkpoint without aborting a healthy peer's request", async () => {
    const victimRelease = deferred<CheckpointDurableExecutionResponse>();
    const peerRelease = deferred<CheckpointDurableExecutionResponse>();
    const calls: { arn: string; signal?: AbortSignal }[] = [];
    const client: DurableExecutionClient = {
      getExecutionState: async () => ({ Operations: [] }),
      checkpoint: async (request, _logger, options) => {
        const arn = request.DurableExecutionArn!;
        calls.push({ arn, signal: options?.abortSignal });
        return arn.includes("/victim/")
          ? victimRelease.promise
          : peerRelease.promise;
      },
    };
    const next = jest.fn(async () => "next");
    const handler = withDurableExecution(
      async (_event, ctx) => {
        await ctx.step("first", async () => "first");
        return await ctx.step("next", next);
      },
      { durableExecutionClient: client },
    );
    const victim = handler(input([], "victim"), runtime(1000)).then(
      () => undefined,
      (error: unknown) => error,
    );
    const peer = handler(input([], "peer"), runtime(10_000));
    await tickUntil(() => calls.length === 2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await victim).toBeInstanceOf(InvocationDeadlineError);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
    victimRelease.resolve({
      CheckpointToken: "victim-late",
      NewExecutionState: undefined,
    });
    peerRelease.resolve({
      CheckpointToken: "peer-live",
      NewExecutionState: undefined,
    });
    await jest.advanceTimersByTimeAsync(20);
    expect((await peer).Status).toBe(InvocationStatus.SUCCEEDED);
    expect(next).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.arn.includes("/victim/"))).toHaveLength(
      1,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not fetch another initialization page or start a handler after expiry", async () => {
    const release = deferred<{ Operations: Operation[]; NextMarker: string }>();
    const store = recorder();
    const getState = jest.fn(() => release.promise);
    store.client.getExecutionState = getState;
    const body = jest.fn(async () => "forbidden");
    const start = jest.fn();
    const event = input();
    const invocation = withDurableExecution(body, {
      durableExecutionClient: store.client,
      plugins: [{ createPlugin: () => ({ onInvocationStart: start }) }],
    })(
      {
        ...event,
        InitialExecutionState: {
          ...event.InitialExecutionState,
          NextMarker: "page-1",
        },
      },
      runtime(1000),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    await tickUntil(() => getState.mock.calls.length === 1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await invocation).toBeInstanceOf(InvocationDeadlineError);
    release.resolve({ Operations: [], NextMarker: "page-2" });
    await jest.advanceTimersByTimeAsync(10);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("preserves an acknowledged oversized result if a state-change hook outlives the deadline", async () => {
    const store = recorder();
    const release = deferred();
    const changed = jest.fn(async () => {
      await release.promise;
    });
    const ended = jest.fn();
    const output = {
      marker: "oversized-output",
      payload: "x".repeat(6 * 1024 * 1024 + 100),
    };
    const result = withDurableExecution(async () => output, {
      durableExecutionClient: store.client,
      plugins: [
        {
          createPlugin: () => ({
            onOperationChange: changed,
            onInvocationEnd: ended,
          }),
        },
      ],
    })(input(), runtime(1000));
    try {
      await tickUntil(() => changed.mock.calls.length === 1);
      expect(store.calls[0].Updates?.[0]).toMatchObject({
        Type: OperationType.EXECUTION,
        Action: "SUCCEED",
      });
      await jest.advanceTimersByTimeAsync(1000);
      expect(await result).toEqual({
        Status: InvocationStatus.SUCCEEDED,
        Result: "",
      });
      expect(ended).toHaveBeenCalledTimes(1);
      expect(ended).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "SUCCEEDED",
          executionError: undefined,
        }),
      );
      // Check identity without printing a multi-megabyte payload on failure.
      expect(ended.mock.calls[0][0].executionResult === output).toBe(true);
    } finally {
      release.resolve();
      await jest.advanceTimersByTimeAsync(10);
    }
    expect(ended).toHaveBeenCalledTimes(1);
    expect(store.calls).toHaveLength(1);
  });

  it("does not expose an oversized result before checkpoint acknowledgement", async () => {
    const store = recorder();
    const release = deferred<CheckpointDurableExecutionResponse>();
    store.checkpoint.mockReturnValue(release.promise);
    const changed = jest.fn();
    const ended = jest.fn();
    const output = {
      marker: "not-acknowledged",
      payload: "x".repeat(6 * 1024 * 1024 + 100),
    };
    const outcome = withDurableExecution(async () => output, {
      durableExecutionClient: store.client,
      plugins: [
        {
          createPlugin: () => ({
            onOperationChange: changed,
            onInvocationEnd: ended,
          }),
        },
      ],
    })(input(), runtime(1000)).then(
      (value) => value,
      (error: unknown) => error,
    );
    await tickUntil(() => store.checkpoint.mock.calls.length === 1);
    expect(store.checkpoint.mock.calls[0][0].Updates?.[0]).toMatchObject({
      Type: OperationType.EXECUTION,
      Action: "SUCCEED",
    });
    try {
      await jest.advanceTimersByTimeAsync(1000);
      expect(await outcome).toBeInstanceOf(InvocationDeadlineError);
      expect(ended).toHaveBeenCalledTimes(1);
      expect(ended.mock.calls[0][0].status).toBe("RETRYING");
      expect("executionResult" in ended.mock.calls[0][0]).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      expect(store.checkpoint.mock.calls[0][2]?.abortSignal?.aborted).toBe(
        true,
      );
    } finally {
      release.resolve({
        CheckpointToken: "late-token",
        NewExecutionState: undefined,
      });
      await jest.advanceTimersByTimeAsync(10);
    }
    expect(ended).toHaveBeenCalledTimes(1);
    expect("executionResult" in ended.mock.calls[0][0]).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(store.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("preserves service-requested suspension when invocation-end exceeds its deadline", async () => {
    const store = recorder();
    store.checkpoint.mockResolvedValue({
      CheckpointToken: undefined,
      NewExecutionState: undefined,
    });
    const release = deferred();
    const ended = jest.fn(async () => release.promise);
    const next = jest.fn(async () => "forbidden");
    const result = withDurableExecution(
      async (_event, ctx) => {
        await ctx.step("withdraw-token", async () => "accepted");
        return ctx.step("next", next);
      },
      {
        durableExecutionClient: store.client,
        plugins: [{ createPlugin: () => ({ onInvocationEnd: ended }) }],
      },
    )(input(), runtime(1000));
    // Observe both outcomes immediately so the negative control does not leave
    // an unhandled rejection when the deadline wins the wrapper's race.
    const outcome = result.then(
      (value) => value,
      (error: unknown) => error,
    );
    try {
      await tickUntil(() => ended.mock.calls.length === 1);
      expect(ended).toHaveBeenCalledWith(
        expect.objectContaining({ status: "PENDING" }),
      );
      await jest.advanceTimersByTimeAsync(1000);
      expect(await outcome).toEqual({ Status: InvocationStatus.PENDING });
      expect(ended).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
      expect(store.checkpoint).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await jest.advanceTimersByTimeAsync(10);
      await outcome;
    }
  });

  it("keeps a created callback suspended when its result deserializes after expiry", async () => {
    const store = recorder();
    store.checkpoint.mockImplementation(async (request) => ({
      CheckpointToken: "live-token",
      NewExecutionState: {
        Operations: (request.Updates ?? []).map((update) => ({
          Id: update.Id,
          Type: update.Type,
          Name: update.Name,
          ParentId: update.ParentId,
          SubType: update.SubType,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: new Date(),
          EndTimestamp: new Date(),
          CallbackDetails: { CallbackId: "callback-id", Result: "saved" },
        })),
      },
    }));
    const release = deferred();
    const deserializing = jest.fn();
    const resumed = jest.fn();
    const finalized = jest.fn();
    const handler = withDurableExecution(
      async (_event, ctx) => {
        try {
          const [callback] = await ctx.createCallback("callback", {
            serdes: {
              deserialize: async () => {
                deserializing();
                await release.promise;
                return "saved";
              },
            },
          });
          await callback;
          resumed();
          return "done";
        } finally {
          finalized();
        }
      },
      { durableExecutionClient: store.client },
    );
    const result = handler(input(), runtime(1000)).catch(
      (error: unknown) => error,
    );
    await tickUntil(() => deserializing.mock.calls.length === 1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toBeInstanceOf(InvocationDeadlineError);
    release.resolve();
    await jest.advanceTimersByTimeAsync(10);
    expect(resumed).not.toHaveBeenCalled();
    expect(finalized).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "keeps replay suspended when deserialization settles after expiry (%s)",
    async (settlement) => {
      const store = recorder();
      const release = deferred();
      const deserializing = jest.fn();
      let holdDeserialization = false;
      const resumed = jest.fn();
      const caught = jest.fn();
      const finalized = jest.fn();
      const step = jest.fn(async () => "saved");
      const handler = withDurableExecution(
        async (_event, ctx) => {
          try {
            const value = await ctx.step("saved-step", step, {
              serdes: {
                serialize: async (value) => JSON.stringify(value),
                deserialize: async () => {
                  if (!holdDeserialization) return "saved";
                  deserializing();
                  await release.promise;
                  if (settlement === "reject")
                    throw new Error("late deserialize failure");
                  return "saved";
                },
              },
            });
            resumed();
            return value;
          } catch (error) {
            caught();
            throw error;
          } finally {
            finalized();
          }
        },
        { durableExecutionClient: store.client },
      );
      const first = handler(input(), runtime());
      await jest.advanceTimersByTimeAsync(10);
      expect(await first).toEqual({
        Status: InvocationStatus.SUCCEEDED,
        Result: '"saved"',
      });
      holdDeserialization = true;
      const replay = handler(
        input([...store.operations.values()]),
        runtime(1000),
      ).catch((error: unknown) => error);
      await tickUntil(() => deserializing.mock.calls.length === 1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(await replay).toBeInstanceOf(InvocationDeadlineError);
      const callsAtExpiry = store.calls.length;
      release.resolve();
      await jest.advanceTimersByTimeAsync(10);
      expect(step).toHaveBeenCalledTimes(1);
      expect(resumed).toHaveBeenCalledTimes(1);
      expect(finalized).toHaveBeenCalledTimes(1);
      expect(caught).not.toHaveBeenCalled();
      expect(store.calls).toHaveLength(callsAtExpiry);
    },
  );

  it("preserves ordinary suspension and replay without unwinding the original stack", async () => {
    const store = recorder();
    const completed = jest.fn(async () => "saved");
    const finished = jest.fn();
    const handler = withDurableExecution(
      async (_event, ctx) => {
        const value = await ctx.step("completed", completed);
        try {
          await ctx.wait("pause", { seconds: 60 });
        } finally {
          finished();
        }
        return value;
      },
      { durableExecutionClient: store.client },
    );
    const first = handler(input(), runtime(5000));
    await jest.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ Status: InvocationStatus.PENDING });
    expect(finished).not.toHaveBeenCalled();
    const wait = [...store.operations.values()].find(
      (op) => op.Type === OperationType.WAIT,
    )!;
    wait.Status = OperationStatus.SUCCEEDED;
    const second = handler(input([...store.operations.values()]), runtime());
    await jest.advanceTimersByTimeAsync(10);
    expect(await second).toEqual({
      Status: InvocationStatus.SUCCEEDED,
      Result: '"saved"',
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("physical invocation deadline timers", () => {
  it("expires a hung invocation even when the runtime getter never decreases", async () => {
    const store = recorder();
    const body = jest.fn(() => new Promise<never>(() => {}));
    const context: Context = {
      ...runtime(),
      getRemainingTimeInMillis: () => 100,
    };
    await expect(
      withDurableExecution(body, { durableExecutionClient: store.client })(
        input(),
        context,
      ),
    ).rejects.toBeInstanceOf(InvocationDeadlineError);
    expect(body).toHaveBeenCalledTimes(1);
    expect(store.checkpoint).not.toHaveBeenCalled();
  });

  it("destroys its native deadline timer on normal completion without a later callback", async () => {
    const store = recorder();
    let capture = true;
    const timers = new Set<number>();
    const fired: number[] = [];
    const destroyed = new Set<number>();
    const hook = createHook({
      init(id, type) {
        if (capture && type === "Timeout") timers.add(id);
      },
      before(id) {
        if (timers.has(id)) fired.push(id);
      },
      destroy(id) {
        if (timers.has(id)) destroyed.add(id);
      },
    });
    hook.enable();
    try {
      const context: Context = {
        ...runtime(),
        getRemainingTimeInMillis: () => 200,
      };
      const result = await withDurableExecution(async () => "done", {
        durableExecutionClient: store.client,
      })(input(), context);
      capture = false;
      expect(result.Status).toBe(InvocationStatus.SUCCEEDED);
      expect(timers.size).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(fired).toEqual([]);
      expect(destroyed).toEqual(timers);
    } finally {
      capture = false;
      hook.disable();
    }
  });
});
