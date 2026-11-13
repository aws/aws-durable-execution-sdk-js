import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import {
  MicrovmDeliveryError,
  MicrovmEndpointUnavailableError,
  microvm,
} from "..";
import { sendJob } from "../request";
import { remainingTime } from "../../deadline";
import { baseConfig, FakeEndpoint, FakeMicrovmsClient } from "./fakes";

const contextWith = (lambdaContext: unknown): DurableContext =>
  ({ lambdaContext }) as unknown as DurableContext;

describe("remainingTime", () => {
  it("returns the value that the Lambda context reports", () => {
    const read = remainingTime(
      contextWith({ getRemainingTimeInMillis: () => 42_000 }),
    );

    expect(read()).toBe(42_000);
  });

  it("calls the function with the Lambda context as `this`", () => {
    const lambdaContext = {
      left: 7_000,
      getRemainingTimeInMillis(this: { left: number }): number {
        return this.left;
      },
    };

    expect(remainingTime(contextWith(lambdaContext))()).toBe(7_000);
  });

  it.each<[string, unknown]>([
    ["no Lambda context", undefined],
    ["a context without the function", {}],
    ["a member that is not a function", { getRemainingTimeInMillis: 1_000 }],
    [
      "a function that returns undefined",
      { getRemainingTimeInMillis: () => undefined },
    ],
  ])("returns undefined for %s", (_label, lambdaContext) => {
    expect(remainingTime(contextWith(lambdaContext))()).toBeUndefined();
  });
});

describe("microvm with a remaining-time reader that throws", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it("fails the job with MicrovmDeliveryError under the default retry strategy, and sends nothing", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          // The local test runner passes a reader that returns a number. So
          // the handler replaces it with one that throws. Child contexts
          // share this Lambda context, so the request step reads it.
          context.lambdaContext.getRemainingTimeInMillis = () => {
            throw new Error("not supported on this compute");
          };
          // A request path makes the job go over HTTP, so it has a request
          // step.
          return microvm(
            context,
            "build",
            {},
            {
              ...baseConfig(client),
              fetch: endpoint.fetch,
              request: { path: "/job" },
            },
          ).catch((error: unknown) => ({
            isDeliveryError: error instanceof MicrovmDeliveryError,
            message: (error as Error).message,
          }));
        },
      ),
    }) as LocalDurableTestRunner<unknown>;

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      isDeliveryError: true,
      message: expect.stringMatching(
        /^MicroVM "build": the job could not be delivered: .*not supported on this compute/,
      ),
    });
    // The default strategy does not retry a plain Error. So the request
    // step makes one attempt.
    expect(runner.getOperation("build.request").getStepDetails()?.attempt).toBe(
      1,
    );
    expect(client.tokenInputs).toHaveLength(0);
    expect(endpoint.requests).toHaveLength(0);
    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });
});

describe("sendJob without a known deadline", () => {
  const send = (
    endpoint: FakeEndpoint,
    remainingTimeMs: (() => number | undefined) | undefined,
  ) => {
    // The fake clock advances by each sleep, so the retry window ends
    // without real waiting.
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const promise = sendJob({
      client: new FakeMicrovmsClient().asClient(),
      fetch: endpoint.fetch,
      microvmId: "mvm-1",
      endpoint: "mvm-1.example",
      path: "/job",
      port: 8080,
      body: "{}",
      retryWindowMs: 2_000,
      remainingTimeMs,
      log: vi.fn(),
      sleep: async (ms) => {
        now += ms;
      },
    });
    return promise.finally(() => spy.mockRestore());
  };

  it.each<[string, (() => number | undefined) | undefined]>([
    ["no reader", undefined],
    ["a reader that returns undefined", () => undefined],
    ["a reader that returns NaN", () => NaN],
    ["a reader that returns Infinity", () => Infinity],
  ])(
    "stops at the end of the retry window with %s",
    async (_label, remainingTimeMs) => {
      const endpoint = new FakeEndpoint();
      endpoint.responses = Array.from({ length: 50 }, () => 503);

      await expect(send(endpoint, remainingTimeMs)).rejects.toBeInstanceOf(
        MicrovmEndpointUnavailableError,
      );
      // The backoff is 250, 500, 1000 ms. The next delay would end past the
      // 2-second window. So the first tier makes 4 requests.
      expect(endpoint.requests).toHaveLength(4);
    },
  );

  it("delivers the job with no deadline", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [503, 202];

    await expect(send(endpoint, () => undefined)).resolves.toBe(202);
  });
});
