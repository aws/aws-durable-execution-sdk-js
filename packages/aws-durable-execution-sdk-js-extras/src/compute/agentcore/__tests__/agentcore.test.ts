import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type DurableContext,
  DurableOperationError,
  StepError,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  type TestResult,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  AccessDeniedException,
  BedrockAgentCoreClient,
  ResourceNotFoundException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-bedrock-agentcore";
import { ComputeError as RootComputeError } from "../../..";
import { agentcoreErrorMapper } from "../errors";
import {
  AgentcoreDeliveryError,
  AgentcoreError,
  AgentcoreJobFailedError,
  AgentcoreOperationSubType,
  AgentcoreTimeoutError,
  type AgentcoreConfig,
  agentcore,
  ComputeError,
  MAX_AGENTCORE_JOB_INPUT_BYTES,
} from "..";
import {
  answer,
  baseConfig,
  FakeAgentcoreClient,
  type Handler,
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

/** Waits for the request step, then completes the callback with `result`. */
async function completeJob(runner: Runner, result: unknown): Promise<void> {
  await runner
    .getOperation("review.request")
    .waitForData(WaitingOperationStatus.COMPLETED);
  await runner
    .getOperation("review.callback")
    .sendCallbackSuccess(JSON.stringify(result));
}

/** What a caller sees of the error. */
interface Seen {
  className: string;
  errorType: string;
  message: string;
}

const CLASSES = [
  AgentcoreDeliveryError,
  AgentcoreJobFailedError,
  AgentcoreTimeoutError,
  AgentcoreError,
];

async function see(run: () => Promise<unknown>): Promise<Seen> {
  try {
    await run();
  } catch (error) {
    const e = error as AgentcoreError;
    return {
      className:
        CLASSES.find((Class) => e instanceof Class)?.name ?? e.constructor.name,
      errorType: e.errorType,
      message: e.message,
    };
  }
  throw new Error("the operation did not fail");
}

/**
 * Runs an operation that fails. The handler records what it saw in a step,
 * then waits, so the next invocation replays the failed operation from its
 * checkpoint. It returns both views, and checks that they are equal.
 */
async function bothViews(
  operation: (context: DurableContext) => Promise<unknown>,
  drive: (runner: Runner) => Promise<void> = async () => {},
): Promise<Seen> {
  const runner = runnerFor(async (context) => {
    const seen = await see(() => operation(context));
    const firstRun = await context.step("record", async () => seen);
    await context.wait("replay", { seconds: 1 });
    return { firstRun, replay: seen };
  });
  const executionPromise = runner.run({ payload: {} });
  await drive(runner);
  const execution = await executionPromise;
  expect(execution.getStatus()).toBe("SUCCEEDED");
  const views = execution.getResult() as { firstRun: Seen; replay: Seen };
  expect(views.replay).toEqual(views.firstRun);
  return views.firstRun;
}

describe("agentcore", () => {
  it("sends the job to a new session, returns the callback result, and stops the session", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcore(
        context,
        "review",
        { pr: 7 },
        {
          ...baseConfig(client),
          qualifier: "DEFAULT",
          heartbeatTimeout: { minutes: 5 },
        },
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, { approved: true });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ approved: true });
    // The handler replays after the callback completes. The request step
    // returns its checkpointed result on replay, so the job is sent once.
    expect(client.invokeInputs).toHaveLength(1);
    const invoke = client.invokeInputs[0];
    const sessionId = runner
      .getOperation("review.session")
      .getStepDetails()?.result;
    expect(invoke).toEqual({
      agentRuntimeArn: RUNTIME_ARN,
      runtimeSessionId: sessionId,
      qualifier: "DEFAULT",
      contentType: "application/json",
      accept: "application/json",
      payload: expect.any(Uint8Array),
    });
    // InvokeAgentRuntime requires a session ID of at least 33 characters.
    expect((invoke.runtimeSessionId as string).length).toBeGreaterThanOrEqual(
      33,
    );
    expect(client.document()).toEqual({
      version: 1,
      region: process.env.AWS_REGION,
      callbackId: runner.getOperation("review.callback").getCallbackDetails()
        ?.callbackId,
      heartbeatTimeoutSeconds: 300,
      input: { pr: 7 },
    });
    expect(client.stopInputs).toEqual([
      {
        agentRuntimeArn: RUNTIME_ARN,
        runtimeSessionId: invoke.runtimeSessionId,
        qualifier: "DEFAULT",
      },
    ]);
  });

  it("omits the qualifier, the heartbeat timeout, and an input that encodes to no value", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcore(context, "review", undefined, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    expect((await executionPromise).getStatus()).toBe("SUCCEEDED");

    expect(client.invokeInputs[0]).not.toHaveProperty("qualifier");
    expect(client.stopInputs[0]).not.toHaveProperty("qualifier");
    expect(Object.keys(client.document()).sort()).toEqual([
      "callbackId",
      "region",
      "version",
    ]);
  });

  it("labels every operation with its subtype", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    const execution = await executionPromise;

    expect(history(execution)).toEqual([
      ["review", "CONTEXT", "Agentcore"],
      ["review.session", "STEP", "AgentcoreSessionId"],
      ["review.callback", "CALLBACK", "AgentcoreCallback"],
      ["review.request", "STEP", "AgentcoreRequest"],
      ["review.stop", "STEP", "AgentcoreStop"],
    ]);
    for (const value of Object.values(AgentcoreOperationSubType)) {
      expect(value).toMatch(/^[a-zA-Z0-9_-]{1,32}$/);
    }
  });

  it("retries a throttled request with the same session ID", async () => {
    const client = new FakeAgentcoreClient();
    client.invokeResponses = [
      throwing(new ThrottlingException({ message: "slow down", ...metadata })),
    ];
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    expect((await executionPromise).getStatus()).toBe("SUCCEEDED");

    expect(client.invokeInputs).toHaveLength(2);
    expect(client.invokeInputs[1].runtimeSessionId).toBe(
      client.invokeInputs[0].runtimeSessionId,
    );
    expect(client.document(1).callbackId).toBe(client.document(0).callbackId);
  });

  it("uses a custom retryStrategy for the request step", async () => {
    const client = new FakeAgentcoreClient();
    client.invokeResponses = [
      throwing(new ThrottlingException({ message: "slow down", ...metadata })),
    ];
    const seen = await bothViews((context) =>
      agentcore(
        context,
        "review",
        {},
        baseConfig(client, { retryStrategy: () => ({ shouldRetry: false }) }),
      ),
    );

    expect(seen.className).toBe("AgentcoreDeliveryError");
    expect(client.invokeInputs).toHaveLength(1);
  });

  it("uses a custom retryStrategy for the stop step", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [
      throwing(new ThrottlingException({ message: "slow down", ...metadata })),
    ];
    let calls = 0;
    const runner = runnerFor((context) =>
      agentcore(
        context,
        "review",
        {},
        baseConfig(client, {
          retryStrategy: () => {
            calls++;
            return { shouldRetry: true, delay: { seconds: 1 } };
          },
        }),
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    expect((await executionPromise).getStatus()).toBe("SUCCEEDED");

    expect(client.stopInputs).toHaveLength(2);
    expect(calls).toBe(1);
  });

  it("reports the agent's failure as AgentcoreJobFailedError and stops the session", async () => {
    const client = new FakeAgentcoreClient();
    const seen = await bothViews(
      (context) => agentcore(context, "review", {}, baseConfig(client)),
      async (runner) => {
        await runner
          .getOperation("review.request")
          .waitForData(WaitingOperationStatus.COMPLETED);
        await runner.getOperation("review.callback").sendCallbackFailure({
          ErrorType: "ReviewFailed",
          ErrorMessage: "3 comments",
        });
      },
    );

    expect(seen).toEqual({
      className: "AgentcoreJobFailedError",
      errorType: "AgentcoreJobFailedError",
      message: expect.stringMatching(
        /^AgentCore "review": the job failed \(ReviewFailed\): .*3 comments/,
      ),
    });
    expect(client.stopInputs).toHaveLength(1);
  });

  it("reports a job without a result in time as AgentcoreTimeoutError and stops the session", async () => {
    const client = new FakeAgentcoreClient();
    const seen = await bothViews((context) =>
      agentcore(
        context,
        "review",
        {},
        baseConfig(client, { timeout: { seconds: 2 } }),
      ),
    );

    expect(seen.className).toBe("AgentcoreTimeoutError");
    expect(seen.errorType).toBe("AgentcoreTimeoutError");
    expect(seen.message).toMatch(/^AgentCore "review": the job timed out: /);
    expect(client.stopInputs).toHaveLength(1);
  });

  it("reports a rejected request as AgentcoreDeliveryError without a retry, and stops the session", async () => {
    const client = new FakeAgentcoreClient();
    client.invokeResponses = [
      throwing(
        new ValidationException({
          message: "bad ARN",
          reason: "FieldValidationFailed",
          ...metadata,
        }),
      ),
    ];
    const seen = await bothViews((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    expect(seen).toEqual({
      className: "AgentcoreDeliveryError",
      errorType: "AgentcoreDeliveryError",
      message: expect.stringMatching(
        /^AgentCore "review": the job could not be delivered: .*bad ARN/,
      ),
    });
    expect(client.invokeInputs).toHaveLength(1);
    expect(client.stopInputs).toHaveLength(1);
  });

  it.each<[string, string, Handler]>([
    [
      "an answer without accepted",
      '{"status":"ok"}',
      answer('{"status":"ok"}'),
    ],
    ["an answer that is not JSON", "busy", answer("busy")],
    ["an answer without a body", "answer: ", async () => ({ statusCode: 200 })],
  ])(
    "reports %s as AgentcoreDeliveryError without a retry",
    async (_label, body, response) => {
      const client = new FakeAgentcoreClient();
      client.invokeResponses = [response];
      const seen = await bothViews((context) =>
        agentcore(context, "review", {}, baseConfig(client)),
      );

      expect(seen.className).toBe("AgentcoreDeliveryError");
      expect(seen.message).toContain("the agent did not accept the job");
      expect(seen.message).toContain(body);
      expect(client.invokeInputs).toHaveLength(1);
    },
  );

  it("quotes at most 256 characters of a refused answer", async () => {
    const client = new FakeAgentcoreClient();
    client.invokeResponses = [answer(`${"a".repeat(256)}${"b".repeat(100)}`)];
    const seen = await bothViews((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    expect(seen.message).toContain(`answer: ${"a".repeat(256)}`);
    expect(seen.message).not.toContain("ab");
  });

  it("returns the result when stop fails, because the result is already recorded", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [
      throwing(new AccessDeniedException({ message: "denied", ...metadata })),
    ];
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    // AccessDeniedException is not retryable, so stop runs once.
    expect(client.stopInputs).toHaveLength(1);
    expect(
      runner.getOperation("review.stop").getStepDetails()?.error,
    ).toBeDefined();
  });

  it("names no job error type when the agent reports a plain Error", async () => {
    const client = new FakeAgentcoreClient();
    const seen = await bothViews(
      (context) => agentcore(context, "review", {}, baseConfig(client)),
      async (runner) => {
        await runner
          .getOperation("review.request")
          .waitForData(WaitingOperationStatus.COMPLETED);
        await runner.getOperation("review.callback").sendCallbackFailure({
          ErrorType: "Error",
          ErrorMessage: "broke",
        });
      },
    );

    expect(seen.message).toMatch(/^AgentCore "review": the job failed: /);
  });

  it("keeps the job's failure when stop fails too", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [
      throwing(new AccessDeniedException({ message: "denied", ...metadata })),
    ];
    const seen = await bothViews(
      (context) => agentcore(context, "review", {}, baseConfig(client)),
      async (runner) => {
        await runner
          .getOperation("review.request")
          .waitForData(WaitingOperationStatus.COMPLETED);
        await runner.getOperation("review.callback").sendCallbackFailure({
          ErrorType: "ReviewFailed",
          ErrorMessage: "3 comments",
        });
      },
    );

    expect(seen.className).toBe("AgentcoreJobFailedError");
  });

  it("treats ResourceNotFoundException from stop as an ended session", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [
      throwing(new ResourceNotFoundException({ message: "gone", ...metadata })),
    ];
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    expect((await executionPromise).getStatus()).toBe("SUCCEEDED");

    expect(
      runner.getOperation("review.stop").getStepDetails()?.error,
    ).toBeUndefined();
  });

  it.each<[string, Partial<AgentcoreConfig>, string]>([
    ["a timeout above 8 hours", { timeout: { hours: 9 } }, "RangeError"],
    ["a missing timeout", { timeout: undefined as never }, "RangeError"],
    [
      "a missing agentRuntimeArn",
      { agentRuntimeArn: undefined as never },
      "TypeError",
    ],
  ])(
    "rejects %s before any durable operation",
    async (_label, overrides, errorType) => {
      const client = new FakeAgentcoreClient();
      const runner = runnerFor((context) =>
        agentcore(context, "review", {}, baseConfig(client, overrides)),
      );

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorType).toBe(errorType);
      expect(execution.getOperations()).toHaveLength(0);
      expect(client.invokeInputs).toHaveLength(0);
    },
  );

  it("rejects an empty name with a TypeError before any durable operation", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcore(context, "", {}, baseConfig(client)),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getError()?.errorType).toBe("TypeError");
    expect(execution.getOperations()).toHaveLength(0);
  });

  it("rejects an input over the size limit, and accepts one at the limit", async () => {
    const client = new FakeAgentcoreClient();
    // The JSON form of a string adds two quotes.
    const atLimit = "x".repeat(MAX_AGENTCORE_JOB_INPUT_BYTES - 2);
    const tooLarge = `${atLimit}x`;
    const runner = runnerFor(async (context) => {
      const error = await agentcore(
        context,
        "big",
        tooLarge,
        baseConfig(client),
      ).catch((e: unknown) => (e as Error).name);
      return {
        error,
        ok: await agentcore(context, "review", atLimit, baseConfig(client)),
      };
    });

    const executionPromise = runner.run({ payload: {} });
    await completeJob(runner, "ok");
    const execution = await executionPromise;

    expect(execution.getResult()).toEqual({ error: "RangeError", ok: "ok" });
    expect(client.invokeInputs).toHaveLength(1);
  });

  it("rejects an input that JSON.stringify cannot encode", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcore(context, "review", { n: 1n }, baseConfig(client)).catch(
        (e: unknown) => ({
          name: (e as Error).name,
          message: (e as Error).message,
        }),
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toEqual({
      name: "TypeError",
      message: expect.stringMatching(
        /^AgentCore "review": the job input must be JSON-serializable: /,
      ),
    });
  });

  it("creates one default client per Region of the agent runtime ARN", async () => {
    const regions: (string | undefined)[] = [];
    const send = vi
      .spyOn(BedrockAgentCoreClient.prototype, "send")
      .mockImplementation(async function (this: BedrockAgentCoreClient) {
        regions.push(await this.config.region());
        return answer('{"accepted":true}')(undefined);
      } as never);
    try {
      const config = { agentRuntimeArn: RUNTIME_ARN, timeout: { minutes: 5 } };
      const runner = runnerFor(async (context) => [
        await agentcore(context, "review", {}, config),
        await agentcore(context, "second", {}, config),
      ]);

      const executionPromise = runner.run({ payload: {} });
      await completeJob(runner, "ok");
      await runner
        .getOperation("second.request")
        .waitForData(WaitingOperationStatus.COMPLETED);
      await runner
        .getOperation("second.callback")
        .sendCallbackSuccess(JSON.stringify("ok"));
      expect((await executionPromise).getResult()).toEqual(["ok", "ok"]);

      // Two jobs, each with a request and a stop, all to the ARN's Region.
      expect(regions).toEqual(Array(4).fill("us-west-2"));
      expect(new Set(send.mock.contexts).size).toBe(1);
    } finally {
      send.mockRestore();
    }
  });

  it("fails before any durable operation when the Region cannot be determined", async () => {
    const client = new FakeAgentcoreClient();
    const saved = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      const runner = runnerFor((context) =>
        agentcore(context, "review", {}, baseConfig(client)),
      );

      const execution = await runner.run({ payload: {} });

      expect(execution.getError()?.errorType).toBe("TypeError");
      expect(execution.getOperations()).toHaveLength(0);
    } finally {
      process.env.AWS_REGION = saved;
    }
  });
});

describe("AgentCore errors", () => {
  it("restores a checkpointed AgentCore type, and wraps any other error in AgentcoreError", () => {
    const map = agentcoreErrorMapper("review");
    const rebuilt = (causeName: string) =>
      new StepError(
        "failed",
        Object.assign(new Error("x"), { name: causeName }),
      );

    expect(map(rebuilt("AgentcoreTimeoutError"))).toBeInstanceOf(
      AgentcoreTimeoutError,
    );
    const other = map(rebuilt("SomethingElse"));
    expect(other.constructor).toBe(AgentcoreError);
    expect(other.message).toBe('AgentCore "review": failed');
    expect(map(new StepError("no cause")).constructor).toBe(AgentcoreError);
  });

  it("exports one ComputeError class from the root and the subpath", () => {
    expect(RootComputeError).toBe(ComputeError);
  });

  it.each(CLASSES.map((Class) => [Class.name, Class] as const))(
    "%s extends AgentcoreError, ComputeError, and DurableOperationError",
    (name, Class) => {
      const error = new Class("failed");

      expect(error).toBeInstanceOf(AgentcoreError);
      expect(error).toBeInstanceOf(ComputeError);
      expect(error).toBeInstanceOf(DurableOperationError);
      expect(error.name).toBe(name);
      expect(error.errorType).toBe(name);
    },
  );
});
