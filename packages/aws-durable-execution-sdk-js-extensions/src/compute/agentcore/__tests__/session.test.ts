import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  type TestResult,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { AccessDeniedException } from "@aws-sdk/client-bedrock-agentcore";
import { agentcore, agentcoreSession } from "..";
import type { AgentcoreInvokeOptions, AgentcoreSessionConfig } from "../types";
import {
  answer,
  FakeAgentcoreClient,
  metadata,
  RUNTIME_ARN,
  throwing,
} from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Runner = LocalDurableTestRunner<unknown>;

/** Lists every operation as [name, type, subtype], in history order. */
const history = (result: TestResult): [string?, string?, string?][] =>
  result
    .getOperations()
    .map((operation) => [
      operation.getName(),
      operation.getType(),
      operation.getSubType(),
    ]);

function runnerFor(
  operation: (context: DurableContext) => Promise<unknown>,
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => operation(context),
    ),
  }) as Runner;
}

const sessionConfig = (
  client: FakeAgentcoreClient,
  overrides: Partial<AgentcoreSessionConfig> = {},
): AgentcoreSessionConfig => ({
  agentRuntimeArn: RUNTIME_ARN,
  client: client.asClient(),
  ...overrides,
});

const denied = () =>
  throwing(new AccessDeniedException({ message: "denied", ...metadata }));

describe("agentcoreSession", () => {
  it("returns the handler's value and stops the session after it", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client, { qualifier: "DEFAULT" }),
        async (session) => {
          // The handler runs before the stop.
          expect(client.stopInputs).toHaveLength(0);
          return { sessionId: session.runtimeSessionId };
        },
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    const sessionId = runner
      .getOperation("review.session")
      .getStepDetails()?.result;
    expect(execution.getResult()).toEqual({ sessionId });
    expect(client.stopInputs).toStrictEqual([
      {
        agentRuntimeArn: RUNTIME_ARN,
        runtimeSessionId: sessionId,
        qualifier: "DEFAULT",
      },
    ]);
  });

  it("stops the session after a handler error, and fails with that error", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(context, "review", sessionConfig(client), async () => {
        throw new Error("handler broke");
      }),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("handler broke");
    // A handler error is not an AgentCore error. So it keeps the type that
    // runInChildContext gives it without an error mapper.
    expect(execution.getError()?.errorType).toBe("ChildContextError");
    // Without a qualifier, the stop input has no qualifier key.
    expect(client.stopInputs).toStrictEqual([
      {
        agentRuntimeArn: RUNTIME_ARN,
        runtimeSessionId: runner.getOperation("review.session").getStepDetails()
          ?.result,
      },
    ]);
  });

  it("returns the handler's value when stop fails", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [denied()];
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async () => "ok",
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    expect(
      runner.getOperation("review.stop").getStepDetails()?.error,
    ).toBeDefined();
  });

  it("keeps the handler's error when stop fails too", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [denied()];
    const runner = runnerFor((context) =>
      agentcoreSession(context, "review", sessionConfig(client), async () => {
        throw new Error("handler broke");
      }),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("handler broke");
    expect(client.stopInputs).toHaveLength(1);
  });

  it("runs the handler's operations in the child context named `name`", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async (_session, child) => {
          await child.wait("pause", { seconds: 1 });
          return "ok";
        },
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(
      execution.getOperations().map((operation) => operation.getName()),
    ).toEqual(["review", "review.session", "pause", "review.stop"]);
    expect(
      runner
        .getOperation("review")
        .getChildOperations()
        ?.map((operation) => operation.getName()),
    ).toEqual(["review.session", "pause", "review.stop"]);
  });

  it("uses the config's retryStrategy for the stop step", async () => {
    const client = new FakeAgentcoreClient();
    // The default strategy does not retry AccessDeniedException.
    client.stopResponses = [denied()];
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client, {
          retryStrategy: (_error, attemptCount) => ({
            shouldRetry: attemptCount < 2,
            delay: { seconds: 1 },
          }),
        }),
        async () => "ok",
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.stopInputs).toHaveLength(2);
    expect(
      runner.getOperation("review.stop").getStepDetails()?.error,
    ).toBeUndefined();
  });

  it.each<[string, string, Partial<AgentcoreSessionConfig>, string]>([
    [
      "an empty name",
      "",
      {},
      "an AgentCore operation requires a non-empty name",
    ],
    [
      "a missing runtime ARN",
      "review",
      { agentRuntimeArn: undefined as unknown as string },
      'AgentCore "review": agentRuntimeArn is required',
    ],
  ])(
    "rejects %s with a TypeError before any durable operation",
    async (_label, name, overrides, message) => {
      const client = new FakeAgentcoreClient();
      const runner = runnerFor((context) => {
        let promise: Promise<string> | undefined;
        // The config error rejects the returned promise. It is not thrown.
        expect(() => {
          promise = agentcoreSession(
            context,
            name,
            sessionConfig(client, overrides),
            async () => "ok",
          );
        }).not.toThrow();
        return promise as Promise<string>;
      });

      const execution = await runner.run({ payload: {} });

      expect(execution.getError()?.errorType).toBe("TypeError");
      expect(execution.getError()?.errorMessage).toBe(message);
      expect(execution.getOperations()).toHaveLength(0);
    },
  );
});

/** Waits for the request step of `job`, then completes its callback. */
async function completeJob(
  runner: Runner,
  job: string,
  result: unknown,
): Promise<void> {
  await runner
    .getOperation(`${job}.request`)
    .waitForData(WaitingOperationStatus.COMPLETED);
  await runner
    .getOperation(`${job}.callback`)
    .sendCallbackSuccess(JSON.stringify(result));
}

/** What a caller sees of an error. */
function seen(error: unknown): {
  className: string;
  errorType: string;
  message: string;
} {
  const e = error as Error & { errorType: string };
  return {
    className: e.constructor.name,
    errorType: e.errorType,
    message: e.message,
  };
}

/**
 * Runs `run`, which must fail, and returns what it saw on the first run and
 * on replay. A step records the first view, and a wait makes the next
 * invocation replay the failed operations from the checkpoint.
 */
async function bothViews(
  run: (context: DurableContext) => Promise<unknown>,
  drive: (runner: Runner) => Promise<void> = async () => {},
): Promise<ReturnType<typeof seen>> {
  const runner = runnerFor(async (context) => {
    const view = await run(context).then(() => {
      throw new Error("the operation did not fail");
    }, seen);
    const firstRun = await context.step("record", async () => view);
    await context.wait("replay", { seconds: 1 });
    return { firstRun, replay: view };
  });
  const executionPromise = runner.run({ payload: {} });
  await drive(runner);
  const execution = await executionPromise;
  expect(execution.getStatus()).toBe("SUCCEEDED");
  const views = execution.getResult() as {
    firstRun: ReturnType<typeof seen>;
    replay: ReturnType<typeof seen>;
  };
  expect(views.replay).toEqual(views.firstRun);
  return views.firstRun;
}

const job = { timeout: { minutes: 5 } };

describe("AgentcoreSession.invoke", () => {
  it("runs two jobs in the same session, each with its own callback, and stops the session once", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async (session, child) => {
          const first = await session.invoke(child, "first", { step: 1 }, job);
          const second = await session.invoke(child, "second", first, job);
          // The session, not a job, stops the session.
          expect(client.stopInputs).toHaveLength(0);
          return [first, second];
        },
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "first", { step: 2 });
    await completeJob(runner, "second", { step: 3 });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([{ step: 2 }, { step: 3 }]);
    const sessionId = runner
      .getOperation("review.session")
      .getStepDetails()?.result;
    expect(client.invokeInputs.map((input) => input.runtimeSessionId)).toEqual([
      sessionId,
      sessionId,
    ]);
    expect(client.document(0)).toMatchObject({
      input: { step: 1 },
      callbackId: runner.getOperation("first.callback").getCallbackDetails()
        ?.callbackId,
    });
    expect(client.document(1)).toMatchObject({
      input: { step: 2 },
      callbackId: runner.getOperation("second.callback").getCallbackDetails()
        ?.callbackId,
    });
    expect(client.document(1).callbackId).not.toBe(
      client.document(0).callbackId,
    );
    expect(client.stopInputs).toHaveLength(1);
    // Each job is a child context named after the job.
    expect(
      runner
        .getOperation("review")
        .getChildOperations()
        ?.map((operation) => operation.getName()),
    ).toEqual(["review.session", "first", "second", "review.stop"]);
    expect(
      runner
        .getOperation("first")
        .getChildOperations()
        ?.map((operation) => operation.getName()),
    ).toEqual(["first.callback", "first.request"]);
  });

  it("labels every operation with its subtype", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async (session, child) => {
          await session.invoke(child, "first", {}, job);
          await session.invoke(child, "second", {}, job);
        },
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "first", "ok");
    await completeJob(runner, "second", "ok");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(history(execution)).toEqual([
      ["review", "CONTEXT", "AgentcoreSession"],
      ["review.session", "STEP", "AgentcoreSessionId"],
      ["first", "CONTEXT", "AgentcoreSessionJob"],
      ["first.callback", "CALLBACK", "AgentcoreCallback"],
      ["first.request", "STEP", "AgentcoreRequest"],
      ["second", "CONTEXT", "AgentcoreSessionJob"],
      ["second.callback", "CALLBACK", "AgentcoreCallback"],
      ["second.request", "STEP", "AgentcoreRequest"],
      ["review.stop", "STEP", "AgentcoreStop"],
    ]);
  });

  it("creates the job in the context passed to invoke", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async (session, child) =>
          child.runInChildContext("inner", (inner) =>
            session.invoke(inner, "job", {}, job),
          ),
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "job", "ok");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    expect(
      runner
        .getOperation("inner")
        .getChildOperations()
        ?.map((operation) => operation.getName()),
    ).toEqual(["job"]);
  });

  it("rejects the job, and the handler can continue in the same session", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async (session, child) => {
          const failure = await session
            .invoke(child, "first", {}, job)
            .then(() => undefined, seen);
          const second = await session.invoke(child, "second", {}, job);
          return { failure, second };
        },
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await runner
      .getOperation("first.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await runner.getOperation("first.callback").sendCallbackFailure({
      ErrorType: "ReviewFailed",
      ErrorMessage: "3 comments",
    });
    await completeJob(runner, "second", "ok");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      failure: {
        className: "AgentcoreJobFailedError",
        errorType: "AgentcoreJobFailedError",
        message: expect.stringMatching(
          /^AgentCore "first": the job failed \(ReviewFailed\): .*3 comments/,
        ),
      },
      second: "ok",
    });
    expect(client.stopInputs).toHaveLength(1);
  });

  it.each([
    {
      error: "AgentcoreJobFailedError",
      options: job,
      drive: async (runner: Runner) => {
        await runner
          .getOperation("first.request")
          .waitForData(WaitingOperationStatus.COMPLETED);
        await runner.getOperation("first.callback").sendCallbackFailure({
          ErrorType: "ReviewFailed",
          ErrorMessage: "3 comments",
        });
      },
    },
    { error: "AgentcoreTimeoutError", options: { timeout: { seconds: 2 } } },
    {
      error: "AgentcoreDeliveryError",
      options: job,
      refuse: true,
    },
  ])(
    "reports a job failure that leaves the session as $error",
    async ({ error, options, drive, refuse }) => {
      const client = new FakeAgentcoreClient();
      if (refuse) {
        client.invokeResponses = [answer('{"accepted":false}')];
      }
      const view = await bothViews(
        (context) =>
          agentcoreSession(
            context,
            "review",
            sessionConfig(client),
            async (session, child) =>
              session.invoke(child, "first", {}, options),
          ),
        drive,
      );

      expect(view.className).toBe(error);
      expect(view.errorType).toBe(error);
      expect(view.message).toMatch(/^AgentCore "first": /);
      expect(client.stopInputs).toHaveLength(1);
    },
  );

  it("rejects an input that JSON cannot encode before any durable operation of the job", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async (session, child) => {
          let promise: Promise<unknown> | undefined;
          // The input error rejects the returned promise. It is not thrown.
          expect(() => {
            promise = session.invoke(child, "first", 1n, job);
          }).not.toThrow();
          return (promise as Promise<unknown>).then(() => undefined, seen);
        },
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toMatchObject({
      className: "TypeError",
      message: expect.stringContaining(
        'AgentCore "first": the job input must be JSON-serializable',
      ),
    });
    expect(
      execution.getOperations().map((operation) => operation.getName()),
    ).toEqual(["review", "review.session", "review.stop"]);
    expect(client.invokeInputs).toHaveLength(0);
  });

  it.each<[string, string, AgentcoreInvokeOptions]>([
    ["an empty job name", "", job],
    ["a timeout of 0 seconds", "first", { timeout: { seconds: 0 } }],
    ["a negative timeout", "first", { timeout: { seconds: -1 } }],
    ["a NaN timeout", "first", { timeout: { seconds: Number.NaN } }],
    [
      "a heartbeat timeout of 0 seconds",
      "first",
      { ...job, heartbeatTimeout: { seconds: 0 } },
    ],
  ])(
    "rejects %s like agentcore, before any durable operation of the job",
    async (_label, jobName, options) => {
      const client = new FakeAgentcoreClient();
      const runner = runnerFor((context) =>
        agentcoreSession(
          context,
          "review",
          sessionConfig(client),
          async (session, child) => {
            let promise: Promise<unknown> | undefined;
            // The error rejects the returned promise. It is not thrown.
            expect(() => {
              promise = session.invoke(child, jobName, {}, options);
            }).not.toThrow();
            const invoked = await (promise as Promise<unknown>).then(
              () => undefined,
              seen,
            );
            const direct = await agentcore(
              child,
              jobName,
              {},
              {
                agentRuntimeArn: RUNTIME_ARN,
                client: client.asClient(),
                ...options,
              },
            ).then(() => undefined, seen);
            return { invoked, direct };
          },
        ),
      );

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      const { invoked, direct } = execution.getResult() as {
        invoked: ReturnType<typeof seen>;
        direct: ReturnType<typeof seen>;
      };
      expect(invoked).toBeDefined();
      expect(invoked).toEqual(direct);
      expect(invoked.className).toBe(jobName ? "RangeError" : "TypeError");
      expect(
        execution.getOperations().map((operation) => operation.getName()),
      ).toEqual(["review", "review.session", "review.stop"]);
      expect(client.invokeInputs).toHaveLength(0);
    },
  );

  it("rejects the job before any durable operation when the Region cannot be determined", async () => {
    const client = new FakeAgentcoreClient();
    const saved = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      const runner = runnerFor((context) =>
        agentcoreSession(
          context,
          "review",
          sessionConfig(client),
          async (session, child) =>
            session.invoke(child, "first", {}, job).then(() => undefined, seen),
        ),
      );

      const execution = await runner.run({ payload: {} });

      expect(execution.getResult()).toEqual({
        className: "TypeError",
        errorType: undefined,
        message:
          'AgentCore "first": cannot determine the AWS Region of the function, because AWS_REGION is not set.',
      });
      expect(
        execution.getOperations().map((operation) => operation.getName()),
      ).toEqual(["review", "review.session", "review.stop"]);
      expect(client.invokeInputs).toHaveLength(0);
    } finally {
      process.env.AWS_REGION = saved;
    }
  });
});
