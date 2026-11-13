// The AgentCore calls end before the invocation reserve.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
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
