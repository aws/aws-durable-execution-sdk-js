// The first retry tier's check after a sign that the MicroVM does not run:
// an HTTP 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, or no answer.
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import {
  MicrovmEndpointUnavailableError,
  type SendJobOptions,
  sendJob,
} from "../request";
import { FakeEndpoint, FakeMicrovmsClient } from "./fakes";

/** The answer of the endpoint of a terminated or suspended MicroVM. */
const connectFailed = (): Response =>
  new Response(null, {
    status: 502,
    headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
  });

describe("sendJob with stateCheck", () => {
  let clock: number;
  let now: MockInstance;

  beforeEach(() => {
    clock = 1_000_000;
    now = vi.spyOn(Date, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    now.mockRestore();
  });

  /** Sends one job. The fake sleep advances the fake clock. */
  function send(
    endpoint: FakeEndpoint,
    overrides: Partial<SendJobOptions> = {},
  ): Promise<number> {
    return sendJob({
      client: new FakeMicrovmsClient().asClient(),
      fetch: endpoint.fetch,
      microvmId: "mvm-1",
      endpoint: "mvm-1.example",
      path: "/job",
      port: 8080,
      body: "{}",
      retryWindowMs: 60_000,
      log: vi.fn(),
      sleep: async (ms) => {
        clock += ms;
      },
      ...overrides,
    });
  }

  it("checks the state after a 502 with MICROVM_CONNECT_FAILED, and sends the job to the endpoint that the check reports", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const stateCheck = vi.fn(async () => "other.example");

    await expect(send(endpoint, { stateCheck })).resolves.toBe(202);

    expect(stateCheck).toHaveBeenCalledTimes(1);
    expect(endpoint.requests.map((r) => r.url)).toEqual([
      "https://mvm-1.example/job",
      "https://other.example/job",
    ]);
  });

  it("checks the state after a request without an answer", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [new TypeError("fetch failed")];
    const stateCheck = vi.fn(async () => undefined);

    await expect(send(endpoint, { stateCheck })).resolves.toBe(202);

    expect(stateCheck).toHaveBeenCalledTimes(1);
    // undefined keeps the current endpoint.
    expect(endpoint.requests.map((r) => r.url)).toEqual([
      "https://mvm-1.example/job",
      "https://mvm-1.example/job",
    ]);
  });

  it.each<[string, () => number | Response]>([
    ["a plain 502", () => 502],
    ["a 503", () => 503],
    ["a 504", () => 504],
    [
      "a 502 with another proxy error",
      () =>
        new Response(null, {
          status: 502,
          headers: { "x-aws-proxy-error": "MICROVM_NOT_READY" },
        }),
    ],
    [
      "a 503 with MICROVM_CONNECT_FAILED",
      () =>
        new Response(null, {
          status: 503,
          headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
        }),
    ],
    ["a 429", () => 429],
    ["a 500", () => 500],
  ])("does not check the state after %s", async (_label, answer) => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [answer(), answer(), answer()];
    const stateCheck = vi.fn(async () => undefined);

    await expect(send(endpoint, { stateCheck })).resolves.toBe(202);

    expect(stateCheck).not.toHaveBeenCalled();
    expect(endpoint.requests).toHaveLength(4);
  });

  it("makes no call for a job accepted at once", async () => {
    const endpoint = new FakeEndpoint();
    const stateCheck = vi.fn(async () => undefined);

    await expect(send(endpoint, { stateCheck })).resolves.toBe(202);

    expect(stateCheck).not.toHaveBeenCalled();
  });

  it("checks again after each failed request, at most once per 2 seconds", async () => {
    const endpoint = new FakeEndpoint();
    // The backoff is 250, 500, 1,000, 2,000, and 4,000 milliseconds. The
    // checks run right after the failed requests that come at least 2
    // seconds after the last check, before the backoff.
    endpoint.responses = [
      connectFailed(),
      connectFailed(),
      new TypeError("fetch failed"),
      connectFailed(),
      connectFailed(),
    ];
    const checkedAt: number[] = [];
    const stateCheck = vi.fn(async () => {
      checkedAt.push(clock - 1_000_000);
      return undefined;
    });

    await expect(send(endpoint, { stateCheck })).resolves.toBe(202);

    expect(endpoint.requests).toHaveLength(6);
    // 0 checks. 250, 750, and 1,750 are within 2 seconds. 3,750 checks.
    // 7,750 is accepted.
    expect(checkedAt).toEqual([0, 3_750]);
  });

  it("re-arms after a request that the check did not fix", async () => {
    const endpoint = new FakeEndpoint();
    // The MicroVM ends after the check reported RUNNING. So the second sign
    // gets its own check.
    endpoint.responses = [connectFailed(), 503, 503, 503, connectFailed()];
    const stateCheck = vi.fn(async () => undefined);

    await expect(send(endpoint, { stateCheck })).resolves.toBe(202);

    expect(stateCheck).toHaveBeenCalledTimes(2);
  });

  it("rethrows an error of the check", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const failure = new Error("state error");

    await expect(
      send(endpoint, {
        stateCheck: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(endpoint.requests).toHaveLength(1);
  });

  it("checks the state when the retry window has no time left", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const stateCheck = vi.fn(async () => undefined);

    // The first backoff of 250 milliseconds would end after the window. The
    // check runs before the window decides.
    const error = await send(endpoint, {
      retryWindowMs: 100,
      stateCheck,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(stateCheck).toHaveBeenCalledTimes(1);
    expect(endpoint.requests).toHaveLength(1);
  });

  it("makes no check when the invocation reserve is reached, and fails as without a check", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const stateCheck = vi.fn(async () => undefined);
    // 11 seconds remain at the start: enough for the first request. The
    // request takes 1.5 seconds, so less than 1 second remains before the
    // reserve when the check is due.
    const endsAt = clock + 11_000;
    const slow: typeof fetch = async (url, init) => {
      clock += 1_500;
      return endpoint.fetch(url, init);
    };

    const error = await send(endpoint, {
      fetch: slow,
      remainingTimeMs: () => endsAt - clock,
      stateCheck,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(error.message).toMatch(/Last failure: HTTP 502\.$/);
    expect(stateCheck).not.toHaveBeenCalled();
    expect(endpoint.requests).toHaveLength(1);
  });
});
