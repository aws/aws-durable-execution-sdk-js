// The SuspendMicrovm call of a suspendAfter job must end before the
// invocation reserve. A Lambda timeout during the call would end the
// invocation with the job's result checkpointed, but the child context not
// complete. These tests use the real clock, because the stalled call ends
// only when its abort signal fires. Each test with a stalled call takes
// about 1.3 seconds.
import { vi, describe, it, expect } from "vitest";
import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { INVOCATION_RESERVE_MS } from "../request";
import { suspendMicrovm, type OperationScope } from "../shared";
import { FakeMicrovmsClient, hangUntilAborted } from "./fakes";

const BUDGET_MS = 1_300;
// The time a test allows past the reserve for timers and scheduling.
const SLACK_MS = 300;

const scopeFor = (client: FakeMicrovmsClient): OperationScope => ({
  name: "pipeline",
  config: {
    imageIdentifier: "img",
    executionRoleArn: "role",
    client: client.asClient(),
  },
  partition: "aws",
  region: "us-east-1",
  retryStrategy: () => ({ shouldRetry: false }),
});

/** A context that reports the time left in the invocation. */
function contextWith(
  remainingMs: () => number,
  warn: ReturnType<typeof vi.fn>,
): DurableContext {
  return {
    lambdaContext: { getRemainingTimeInMillis: remainingMs },
    logger: { warn },
  } as unknown as DurableContext;
}

describe("suspendMicrovm near the invocation reserve", () => {
  it("stops a stalled call at the reserve, and logs a warning instead of throwing", async () => {
    const client = new FakeMicrovmsClient();
    client.suspendResponses = [hangUntilAborted];
    const warn = vi.fn();
    const reserveAt = Date.now() + BUDGET_MS;
    const endsAt = reserveAt + INVOCATION_RESERVE_MS;

    await suspendMicrovm(
      contextWith(() => endsAt - Date.now(), warn),
      scopeFor(client),
      "build",
      "mvm-1",
    );

    expect(Date.now()).toBeLessThan(reserveAt + SLACK_MS);
    expect(client.suspendInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      'MicroVM "build": suspend after the job failed for mvm-1.',
    );
    // The call may have reached the service, so the warning does not claim
    // that the MicroVM runs.
    expect(warn.mock.calls[0][0]).toContain("The MicroVM may still be running");
    expect(warn.mock.calls[0][1].error.name).toBe(
      "MicrovmEndpointUnavailableError",
    );
  });

  it("starts no call when the reserve is already reached", async () => {
    const client = new FakeMicrovmsClient();
    const warn = vi.fn();

    await suspendMicrovm(
      contextWith(() => INVOCATION_RESERVE_MS, warn),
      scopeFor(client),
      "build",
      "mvm-1",
    );

    expect(client.suspendInputs).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("sends the call without a deadline when the compute reports none", async () => {
    const client = new FakeMicrovmsClient();
    const warn = vi.fn();

    await suspendMicrovm(
      { logger: { warn } } as unknown as DurableContext,
      scopeFor(client),
      "build",
      "mvm-1",
    );

    expect(client.suspendInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
    expect(warn).not.toHaveBeenCalled();
  });
});
