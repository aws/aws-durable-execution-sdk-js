// The request step fails at once, with a message that names the function
// timeout, when too little time is left. A session job calls GetMicrovm
// before sendJob, so the step must check the time before that call too. The
// local test runner always reports 900 seconds left. So these tests call
// deliverJob directly with a stub context.
import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { MicrovmEndpointUnavailableError } from "../request";
import { deliverJob, type OperationScope } from "../shared";
import { FakeEndpoint, FakeMicrovmsClient } from "./fakes";

/** A context whose step runs its function once and passes the error on. */
function stubContext(remainingMs: number): DurableContext {
  return {
    lambdaContext: { getRemainingTimeInMillis: () => remainingMs },
    step: async (
      _name: string,
      fn: (stepContext: unknown) => Promise<unknown>,
    ): Promise<unknown> => fn({ logger: { info: jest.fn() } }),
  } as unknown as DurableContext;
}

const deliver = (
  remainingMs: number,
  resume: boolean,
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
): Promise<void> => {
  const scope: OperationScope = {
    name: "pipeline",
    config: {
      imageIdentifier: "img",
      executionRoleArn: "role",
      client: client.asClient(),
      fetch: endpoint.fetch,
    },
    partition: "aws",
    region: "us-east-1",
    retryStrategy: () => ({ shouldRetry: false }),
  };
  return deliverJob(
    stubContext(remainingMs),
    scope,
    "build",
    { microvmId: "mvm-1", endpoint: "mvm-1.example", delivery: "http" },
    { path: "/job" },
    { callbackId: "cb-1", input: {} },
    { resume },
  );
};

describe("the request step with too little time left", () => {
  it.each([
    ["a microvm job", false],
    ["a session job that checks the state first", true],
  ])("names the function timeout for %s", async (_label, resume) => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();

    const error = await deliver(2_900, resume, client, endpoint).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(MicrovmEndpointUnavailableError);
    expect((error as Error).message).toBe(
      "The request step had 2.9 seconds left in the Lambda invocation, and it needs at least 11 seconds to send the job. Raise the function timeout.",
    );
    expect(client.events).toEqual([]);
    expect(client.tokenInputs).toHaveLength(0);
    expect(endpoint.requests).toHaveLength(0);
  });

  it("rounds the time left down", async () => {
    const error = await deliver(
      10_960,
      false,
      new FakeMicrovmsClient(),
      new FakeEndpoint(),
    ).catch((e: unknown) => e);

    // Rounding to the nearest tenth would print 11.0, next to "at least 11".
    expect((error as Error).message).toContain("had 10.9 seconds left");
  });
});
