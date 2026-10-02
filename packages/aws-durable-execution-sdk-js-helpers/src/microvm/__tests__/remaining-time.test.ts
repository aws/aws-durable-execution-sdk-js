import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { MicrovmEndpointUnavailableError } from "..";
import { sendJob } from "../request";
import { remainingTime } from "../shared";
import { FakeEndpoint, FakeMicrovmsClient } from "./fakes";

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
    ["a function that returns NaN", { getRemainingTimeInMillis: () => NaN }],
    [
      "a function that returns Infinity",
      { getRemainingTimeInMillis: () => Infinity },
    ],
    [
      "a function that returns a string",
      { getRemainingTimeInMillis: () => "5" },
    ],
    [
      "a function that throws",
      {
        getRemainingTimeInMillis: () => {
          throw new Error("not supported on this compute");
        },
      },
    ],
  ])("returns undefined for %s", (_label, lambdaContext) => {
    expect(remainingTime(contextWith(lambdaContext))()).toBeUndefined();
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
    const spy = jest.spyOn(Date, "now").mockImplementation(() => now);
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
      log: jest.fn(),
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

describe("sendJob with a recheck", () => {
  it("gives each recheck only what remains of the retry window", async () => {
    let now = 1_000_000;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => now);
    const endpoint = new FakeEndpoint();
    endpoint.responses = Array.from({ length: 50 }, () => 502);
    const budgets: number[] = [];

    const promise = sendJob({
      client: new FakeMicrovmsClient().asClient(),
      fetch: endpoint.fetch,
      microvmId: "mvm-1",
      endpoint: "mvm-1.example",
      path: "/job",
      port: 8080,
      body: "{}",
      retryWindowMs: 2_000,
      log: jest.fn(),
      sleep: async (ms) => {
        now += ms;
      },
      // Each recheck waits for as long as it may, like a MicroVM that stays
      // SUSPENDING.
      recheck: async (maxWaitMs) => {
        budgets.push(maxWaitMs);
        now += maxWaitMs;
        return undefined;
      },
    });
    const started = now;

    await expect(
      promise.finally(() => spy.mockRestore()),
    ).rejects.toBeInstanceOf(MicrovmEndpointUnavailableError);
    // The first recheck gets the window minus the first 250 ms backoff, and
    // uses it up. So the tier ends at the window, not at twice the window.
    expect(budgets).toEqual([1_750]);
    expect(now - started).toBe(2_000);
    expect(endpoint.requests).toHaveLength(2);
  });

  it("skips the recheck and ends the tier when no time remains after the backoff", async () => {
    let now = 1_000_000;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => now);
    const endpoint = new FakeEndpoint();
    endpoint.responses = [502, 202];
    const recheck = jest.fn(async () => undefined);

    const promise = sendJob({
      client: new FakeMicrovmsClient().asClient(),
      fetch: endpoint.fetch,
      microvmId: "mvm-1",
      endpoint: "mvm-1.example",
      path: "/job",
      port: 8080,
      body: "{}",
      // The first backoff, 250 ms, uses up the whole window.
      retryWindowMs: 250,
      log: jest.fn(),
      sleep: async (ms) => {
        now += ms;
      },
      recheck,
    });

    await expect(
      promise.finally(() => spy.mockRestore()),
    ).rejects.toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(recheck).not.toHaveBeenCalled();
    expect(endpoint.requests).toHaveLength(1);
  });
});
