// The first retry tier's check after a sign of a suspended MicroVM: an HTTP
// 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, or no answer.
import { MicrovmEndpointUnavailableError } from "..";
import { type SendJobOptions, sendJob } from "../request";
import { FakeEndpoint, FakeMicrovmsClient } from "./fakes";

/** The answer of the endpoint of a suspending or suspended MicroVM. */
const connectFailed = (): Response =>
  new Response(null, {
    status: 502,
    headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
  });

describe("sendJob with suspendCheck", () => {
  let clock: number;
  let now: jest.SpyInstance;

  beforeEach(() => {
    clock = 1_000_000;
    now = jest.spyOn(Date, "now").mockImplementation(() => clock);
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
      log: jest.fn(),
      sleep: async (ms) => {
        clock += ms;
      },
      ...overrides,
    });
  }

  it("checks the state after a 502 with MICROVM_CONNECT_FAILED, and sends the job to the endpoint that the check reports", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const suspendCheck = jest.fn(async () => "resumed.example");

    await expect(send(endpoint, { suspendCheck })).resolves.toBe(202);

    expect(suspendCheck).toHaveBeenCalledTimes(1);
    // The check gets what remains of the window: 60 seconds minus the first
    // 250-millisecond backoff.
    expect(suspendCheck).toHaveBeenCalledWith(59_750);
    expect(endpoint.requests.map((r) => r.url)).toEqual([
      "https://mvm-1.example/job",
      "https://resumed.example/job",
    ]);
  });

  it("checks the state after a request without an answer", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [new TypeError("fetch failed")];
    const suspendCheck = jest.fn(async () => undefined);

    await expect(send(endpoint, { suspendCheck })).resolves.toBe(202);

    expect(suspendCheck).toHaveBeenCalledTimes(1);
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
    const suspendCheck = jest.fn(async () => undefined);

    await expect(send(endpoint, { suspendCheck })).resolves.toBe(202);

    expect(suspendCheck).not.toHaveBeenCalled();
    expect(endpoint.requests).toHaveLength(4);
  });

  it("makes no call for a job accepted at once", async () => {
    const endpoint = new FakeEndpoint();
    const suspendCheck = jest.fn(async () => undefined);

    await expect(send(endpoint, { suspendCheck })).resolves.toBe(202);

    expect(suspendCheck).not.toHaveBeenCalled();
  });

  it("checks again after each failed request, at most once per 2 seconds", async () => {
    const endpoint = new FakeEndpoint();
    // The backoff is 250, 500, 1,000, 2,000, and 4,000 milliseconds. The
    // checks run after the requests whose backoff ends at least 2 seconds
    // after the last check.
    endpoint.responses = [
      connectFailed(),
      connectFailed(),
      new TypeError("fetch failed"),
      connectFailed(),
      connectFailed(),
    ];
    const checkedAt: number[] = [];
    const suspendCheck = jest.fn(async () => {
      checkedAt.push(clock - 1_000_000);
      return undefined;
    });

    await expect(send(endpoint, { suspendCheck })).resolves.toBe(202);

    expect(endpoint.requests).toHaveLength(6);
    // 250 checks. 750 and 1,750 are within 2 seconds. 3,750 checks. 7,750
    // checks.
    expect(checkedAt).toEqual([250, 3_750, 7_750]);
  });

  it("re-arms after a request that the check did not fix", async () => {
    const endpoint = new FakeEndpoint();
    // The worker suspends again after the check reported RUNNING. So the
    // second sign of a suspended MicroVM gets its own check.
    endpoint.responses = [connectFailed(), 503, 503, 503, connectFailed()];
    const suspendCheck = jest.fn(async () => undefined);

    await expect(send(endpoint, { suspendCheck })).resolves.toBe(202);

    expect(suspendCheck).toHaveBeenCalledTimes(2);
  });

  it("rethrows an error of the check", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const failure = new Error("state error");

    await expect(
      send(endpoint, {
        suspendCheck: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(endpoint.requests).toHaveLength(1);
  });

  it("uses recheck, not suspendCheck, when both are set", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = [503];
    const recheck = jest.fn(async () => undefined);
    const suspendCheck = jest.fn(async () => undefined);

    await expect(send(endpoint, { recheck, suspendCheck })).resolves.toBe(202);

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(suspendCheck).not.toHaveBeenCalled();
  });

  it("adds the note to the final MicrovmEndpointUnavailableError", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = Array.from({ length: 20 }, connectFailed);

    const error = await send(endpoint, {
      retryWindowMs: 5_000,
      suspendCheck: async () => undefined,
      unavailableNote: () =>
        "GetMicrovm was denied, so the operation could not check whether the MicroVM is suspended.",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(error.message).toMatch(
      /Last failure: HTTP 502\. GetMicrovm was denied, so the operation could not check whether the MicroVM is suspended\.$/,
    );
  });

  it("keeps the message unchanged when the note is undefined", async () => {
    const endpoint = new FakeEndpoint();
    endpoint.responses = Array.from({ length: 20 }, () => 503);

    const error = await send(endpoint, {
      retryWindowMs: 5_000,
      unavailableNote: () => undefined,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(error.message).toMatch(/Last failure: HTTP 503\.$/);
  });
});
