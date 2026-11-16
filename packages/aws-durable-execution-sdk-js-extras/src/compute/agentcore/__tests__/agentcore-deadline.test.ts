// The AgentCore calls end before the invocation reserve.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DurableContext,
  type DurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { AccessDeniedException } from "@aws-sdk/client-bedrock-agentcore";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { INVOCATION_RESERVE_MS } from "../../deadline";
import { agentcore } from "..";
import { baseConfig, FakeAgentcoreClient, type Handler } from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Runner = LocalDurableTestRunner<unknown>;

/** How far away the reserve is when a stalled call starts. */
const RESERVE_IN_MS = 1_500;
/** How late after the reserve a stopped call may end. */
const SLACK_MS = 500;

/**
 * The invocation ends at `endsAt`. Each test moves it. The handler reads it
 * through the Lambda context of every invocation.
 */
let endsAt = Number.POSITIVE_INFINITY;
const farAway = (): number => Date.now() + 3_600_000;

function runnerFor(
  operation: (context: DurableContext) => Promise<unknown>,
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        (
          context.lambdaContext as { getRemainingTimeInMillis: () => number }
        ).getRemainingTimeInMillis = () => endsAt - Date.now();
        return operation(context);
      },
    ),
  }) as Runner;
}

/**
 * A call that ends only when its abort signal fires. It records when the
 * signal fired. The next invocation then has an hour left, so the next
 * attempt has time.
 */
function stalled(abortedAt: number[]): Handler {
  return (_input, options) =>
    new Promise((_, reject) => {
      options?.abortSignal?.addEventListener("abort", () => {
        abortedAt.push(Date.now());
        endsAt = farAway();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
}

describe("agentcore invocation reserve", () => {
  it("stops a stalled InvokeAgentRuntime call at the reserve, and the request step retries", async () => {
    const client = new FakeAgentcoreClient();
    const abortedAt: number[] = [];
    client.invokeResponses = [stalled(abortedAt)];
    endsAt = Date.now() + RESERVE_IN_MS + INVOCATION_RESERVE_MS;
    const reserveAt = endsAt - INVOCATION_RESERVE_MS;
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await runner
      .getOperation("review.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await runner
      .getOperation("review.callback")
      .sendCallbackSuccess(JSON.stringify("ok"));
    const execution = await executionPromise;

    expect(execution.getResult()).toBe("ok");
    expect(abortedAt).toHaveLength(1);
    expect(abortedAt[0]).toBeLessThan(reserveAt + SLACK_MS);
    // The first attempt stopped at the reserve, and the second delivered
    // the same job to the same session.
    expect(client.invokeInputs).toHaveLength(2);
    expect(client.invokeInputs[1].runtimeSessionId).toBe(
      client.invokeInputs[0].runtimeSessionId,
    );
  });

  it("stops a stalled StopRuntimeSession at the reserve, and returns the recorded result", async () => {
    const client = new FakeAgentcoreClient();
    const abortedAt: number[] = [];
    client.stopResponses = [stalled(abortedAt)];
    endsAt = farAway();
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)),
    );

    const executionPromise = runner.run({ payload: {} });
    await runner
      .getOperation("review.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    endsAt = Date.now() + RESERVE_IN_MS + INVOCATION_RESERVE_MS;
    const reserveAt = endsAt - INVOCATION_RESERVE_MS;
    await runner
      .getOperation("review.callback")
      .sendCallbackSuccess(JSON.stringify("ok"));
    const execution = await executionPromise;

    expect(execution.getResult()).toBe("ok");
    expect(abortedAt).toHaveLength(1);
    expect(abortedAt[0]).toBeLessThan(reserveAt + SLACK_MS);
    // The stopped attempt is retryable. The second attempt stops the
    // session.
    expect(client.stopInputs).toHaveLength(2);
  });
});

describe("agentcore with too little time in the invocation", () => {
  /** A durable logger that keeps the error messages. */
  function errorLogger(errors: string[]): DurableLogger {
    const ignore = (): void => {};
    return {
      log: ignore,
      info: ignore,
      debug: ignore,
      warn: ignore,
      error: (message: string) => {
        errors.push(message);
      },
    };
  }

  it("makes no AgentCore call, says to raise the function timeout, and diagnoses no permission", async () => {
    const client = new FakeAgentcoreClient();
    const errors: string[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          // Lambda's default function timeout is 3 seconds.
          (
            context.lambdaContext as { getRemainingTimeInMillis: () => number }
          ).getRemainingTimeInMillis = () => 3_000;
          context.configureLogger({ customLogger: errorLogger(errors) });
          return agentcore(context, "review", {}, baseConfig(client)).catch(
            (error: unknown) => (error as Error).message,
          );
        },
      ),
    }) as Runner;

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toContain(
      "The request step had 3.0 seconds left in the Lambda invocation, and it needs at least 11 seconds to send the job. Raise the function timeout.",
    );
    expect(client.invokeInputs).toHaveLength(0);
    expect(client.stopInputs).toHaveLength(0);
    const stopErrors = errors.filter((message) =>
      message.includes("StopRuntimeSession failed"),
    );
    expect(stopErrors).toHaveLength(1);
    expect(stopErrors[0]).not.toContain("bedrock-agentcore:StopRuntimeSession");
    expect(
      JSON.stringify(
        runner.getOperation("review.stop").getStepDetails()?.error,
      ),
    ).toContain(
      "needs at least 11 seconds to stop the session. Raise the function timeout.",
    );
  });

  it("names the stop permission for AccessDeniedException, and maxLifetime for a running handler", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [
      async () => {
        throw new AccessDeniedException({ message: "denied", $metadata: {} });
      },
    ];
    const errors: string[] = [];
    endsAt = farAway();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          context.configureLogger({ customLogger: errorLogger(errors) });
          return agentcore(context, "review", {}, baseConfig(client));
        },
      ),
    }) as Runner;

    const executionPromise = runner.run({ payload: {} });
    await runner
      .getOperation("review.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await runner
      .getOperation("review.callback")
      .sendCallbackSuccess(JSON.stringify("ok"));
    expect((await executionPromise).getResult()).toBe("ok");

    const [stopError] = errors.filter((message) =>
      message.includes("StopRuntimeSession failed"),
    );
    expect(stopError).toContain("until the runtime's maxLifetime");
    expect(stopError).toContain(
      "needs bedrock-agentcore:StopRuntimeSession on the agent runtime ARN",
    );
  });
});
