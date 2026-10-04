// Every call of the first retry tier must end before the invocation reserve.
// A Lambda timeout during a step attempt records no outcome for the attempt.
// These tests use the real clock, because each stalled call ends only when
// its abort signal fires. Each test keeps a budget of about 1.3 seconds
// before the reserve, so each test takes about that long.
import { MicrovmEndpointUnavailableError } from "..";
import { ensureRunning } from "../lifecycle";
import { INVOCATION_RESERVE_MS, sendJob } from "../request";
import { FakeEndpoint, FakeMicrovmsClient, hangUntilAborted } from "./fakes";

const BUDGET_MS = 1_300;
// The time a test allows past the reserve for timers and scheduling.
const SLACK_MS = 300;

/** A remaining-time reader for an invocation that ends at `endsAt`. */
const endingAt =
  (endsAt: number): (() => number) =>
  () =>
    endsAt - Date.now();

const sendWith = (
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  remainingTimeMs: () => number,
) =>
  sendJob({
    client: client.asClient(),
    fetch: endpoint.fetch,
    microvmId: "mvm-1",
    endpoint: "mvm-1.example",
    path: "/job",
    port: 8080,
    body: "{}",
    // The window is much longer than the invocation. So only the reserve
    // can end the tier.
    retryWindowMs: 60_000,
    remainingTimeMs,
    log: jest.fn(),
  });

describe("sendJob near the invocation reserve", () => {
  it("stops a stalled request at the reserve", async () => {
    // The reviewer's case: the second request stalls. Before the fix, it ran
    // for its whole 10-second timeout, which equals the reserve.
    const started = Date.now();
    const reserveAt = started + BUDGET_MS;
    const endpoint = new FakeEndpoint();
    endpoint.responses = [503, "hang"];

    const error = await sendWith(
      new FakeMicrovmsClient(),
      endpoint,
      endingAt(reserveAt + INVOCATION_RESERVE_MS),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(endpoint.requests).toHaveLength(2);
    expect(Date.now()).toBeLessThan(reserveAt + SLACK_MS);
  });

  it("stops a stalled auth token refresh at the reserve", async () => {
    const started = Date.now();
    const reserveAt = started + BUDGET_MS;
    const client = new FakeMicrovmsClient();
    // The first token is created at once. The refresh after the 401 stalls.
    client.tokenResponses = [
      async () => ({ authToken: { "X-aws-proxy-auth": "token-1" } }),
      hangUntilAborted,
    ];
    const endpoint = new FakeEndpoint();
    endpoint.responses = [401];

    const error = await sendWith(
      client,
      endpoint,
      endingAt(reserveAt + INVOCATION_RESERVE_MS),
    ).catch((e: unknown) => e);

    // The AWS SDK's AbortError is not retryable. So the abort is reported
    // as the retryable MicrovmEndpointUnavailableError.
    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(client.tokenInputs).toHaveLength(2);
    expect(Date.now()).toBeLessThan(reserveAt + SLACK_MS);
  });

  it("starts no call when less than 1 second remains before the reserve", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();

    const error = await sendWith(
      client,
      endpoint,
      endingAt(Date.now() + 500 + INVOCATION_RESERVE_MS),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect((error as Error).message).toContain("after 0 attempts");
    expect(client.tokenInputs).toHaveLength(0);
    expect(endpoint.requests).toHaveLength(0);
  });

  it("passes on an AWS SDK error that the abort signal did not cause", async () => {
    const client = new FakeMicrovmsClient();
    const throttled = Object.assign(new Error("Rate exceeded"), {
      name: "ThrottlingException",
    });
    client.tokenResponses = [
      async () => {
        throw throttled;
      },
    ];

    await expect(
      sendWith(
        client,
        new FakeEndpoint(),
        endingAt(Date.now() + BUDGET_MS + INVOCATION_RESERVE_MS),
      ),
    ).rejects.toBe(throttled);
  });
});

describe("ensureRunning near the invocation reserve", () => {
  const ensureWith = (
    client: FakeMicrovmsClient,
    remainingTimeMs: () => number,
  ) =>
    ensureRunning({
      client: client.asClient(),
      microvmId: "mvm-1",
      maxWaitMs: 60_000,
      remainingTimeMs,
      log: jest.fn(),
    });

  it("stops a stalled GetMicrovm at the reserve", async () => {
    const reserveAt = Date.now() + BUDGET_MS;
    const client = new FakeMicrovmsClient();
    client.getResponses = [hangUntilAborted];

    await expect(
      ensureWith(client, endingAt(reserveAt + INVOCATION_RESERVE_MS)),
    ).rejects.toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(Date.now()).toBeLessThan(reserveAt + SLACK_MS);
  });

  it("stops a stalled ResumeMicrovm at the reserve", async () => {
    const reserveAt = Date.now() + BUDGET_MS;
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    client.resumeResponses = [hangUntilAborted];

    await expect(
      ensureWith(client, endingAt(reserveAt + INVOCATION_RESERVE_MS)),
    ).rejects.toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect(client.events).toEqual(["get:SUSPENDED", "resume"]);
    expect(Date.now()).toBeLessThan(reserveAt + SLACK_MS);
  });
});
