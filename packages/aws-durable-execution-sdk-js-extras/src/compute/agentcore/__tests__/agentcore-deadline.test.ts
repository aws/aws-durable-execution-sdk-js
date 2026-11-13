// The AgentCore calls end before the invocation reserve, and the request
// step reads a bounded part of the agent's answer.
import { Readable } from "node:stream";
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
 * Starts a stalled call: the reserve is {@link RESERVE_IN_MS} away. The
 * call records when its abort signal fired, and the next invocation then
 * has an hour left, so the next attempt has time.
 */
function stalled(stall: Handler, abortedAt: number[]): Handler {
  return (input, options) => {
    options?.abortSignal?.addEventListener("abort", () => {
      abortedAt.push(Date.now());
      endsAt = farAway();
    });
    return stall(input, options);
  };
}

const hang: Handler = (_input, options) =>
  new Promise((_, reject) => {
    options?.abortSignal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });

/** An answer whose body sends no data and never ends. */
const silentBody: Handler = async () => ({
  statusCode: 200,
  contentType: "application/json",
  response: new Readable({ read: () => {} }),
});

describe("agentcore invocation reserve", () => {
  it.each<[string, Handler]>([
    ["InvokeAgentRuntime call", hang],
    ["answer stream", silentBody],
  ])(
    "stops a stalled %s at the reserve, and the request step retries",
    async (_label, stall) => {
      const client = new FakeAgentcoreClient();
      const abortedAt: number[] = [];
      const handler = stalled(stall, abortedAt);
      client.invokeResponses = [handler];
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

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe("ok");
      expect(abortedAt).toHaveLength(1);
      expect(abortedAt[0]).toBeLessThan(reserveAt + SLACK_MS);
      // The first attempt stopped at the reserve, and the second delivered
      // the same job to the same session.
      expect(client.invokeInputs).toHaveLength(2);
      expect(client.invokeInputs[1].runtimeSessionId).toBe(
        client.invokeInputs[0].runtimeSessionId,
      );
    },
  );

  it("stops at once when the call answers after the reserve", async () => {
    const client = new FakeAgentcoreClient();
    const abortedAt: number[] = [];
    // The call ends after its signal fired, with a body that never ends.
    const lateAnswer: Handler = (input, options) =>
      new Promise((resolve) => {
        options?.abortSignal?.addEventListener("abort", () =>
          resolve(silentBody(input, options)),
        );
      });
    client.invokeResponses = [stalled(lateAnswer, abortedAt)];
    endsAt = Date.now() + RESERVE_IN_MS + INVOCATION_RESERVE_MS;
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

    // The body never ends. So the first attempt ended only because the read
    // saw the signal that had already fired.
    expect((await executionPromise).getResult()).toBe("ok");
    expect(abortedAt).toHaveLength(1);
    expect(client.invokeInputs).toHaveLength(2);
  });

  it("stops a stalled StopRuntimeSession at the reserve, and returns the recorded result", async () => {
    const client = new FakeAgentcoreClient();
    const abortedAt: number[] = [];
    const handler = stalled(hang, abortedAt);
    client.stopResponses = [handler];
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

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    expect(abortedAt).toHaveLength(1);
    expect(abortedAt[0]).toBeLessThan(reserveAt + SLACK_MS);
    // The stopped attempt is retryable. The second attempt stops the
    // session.
    expect(client.stopInputs).toHaveLength(2);
  });
});

describe("agentcore answer limit", () => {
  it("fails an answer over 64 KiB as not accepted, without reading all of it", async () => {
    const client = new FakeAgentcoreClient();
    let chunksRead = 0;
    // 1 KiB chunks without an end.
    function* endless(): Generator<Buffer> {
      for (;;) {
        chunksRead++;
        yield Buffer.alloc(1_024, "a");
      }
    }
    client.invokeResponses = [
      async () => ({
        statusCode: 200,
        contentType: "application/json",
        response: Readable.from(endless()),
      }),
    ];
    endsAt = farAway();
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)).catch(
        (error: unknown) => ({
          name: (error as Error).name,
          message: (error as Error).message,
        }),
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toEqual({
      name: "AgentcoreDeliveryError",
      message: expect.stringContaining(
        'the agent did not accept the job. It must answer {"accepted": true}. Status 200, answer: longer than 65536 bytes',
      ),
    });
    // The answer is not accepted, so the step does not retry it.
    expect(client.invokeInputs).toHaveLength(1);
    // 65 chunks pass the limit. The stream reads a few more ahead.
    expect(chunksRead).toBeGreaterThanOrEqual(65);
    expect(chunksRead).toBeLessThan(100);
  });

  it("reads a body that offers only a web stream", async () => {
    const client = new FakeAgentcoreClient();
    client.invokeResponses = [
      async () => ({
        statusCode: 200,
        contentType: "application/json",
        response: {
          transformToWebStream: () => new Blob(['{"accepted":true}']).stream(),
        },
      }),
    ];
    endsAt = farAway();
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

    expect((await executionPromise).getResult()).toBe("ok");
    expect(client.invokeInputs).toHaveLength(1);
  });

  it("fails an answer over the limit when cancelling the stream throws", async () => {
    const client = new FakeAgentcoreClient();
    // An endless body whose return() throws.
    const body: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: Buffer.alloc(1_024, "a") }),
        return: () => {
          throw new Error("cancel failed");
        },
      }),
    };
    client.invokeResponses = [
      async () => ({ statusCode: 200, response: body }),
    ];
    endsAt = farAway();
    const runner = runnerFor((context) =>
      agentcore(context, "review", {}, baseConfig(client)).catch(
        (error: unknown) => (error as Error).name,
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toBe("AgentcoreDeliveryError");
  });

  it("accepts an answer that arrives in several chunks", async () => {
    const client = new FakeAgentcoreClient();
    client.invokeResponses = [
      async () => ({
        statusCode: 200,
        contentType: "application/json",
        response: Readable.from([
          Buffer.from('{"acc'),
          Buffer.from('epted":'),
          Buffer.from("true}"),
        ]),
      }),
    ];
    endsAt = farAway();
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

    expect((await executionPromise).getResult()).toBe("ok");
    expect(client.invokeInputs).toHaveLength(1);
  });
});
