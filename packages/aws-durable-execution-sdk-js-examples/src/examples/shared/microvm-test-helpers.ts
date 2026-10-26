import {
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";

const ENDED_STATES = ["TERMINATING", "TERMINATED"];
const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 150_000;

/**
 * Expects that the operation terminated the MicroVM.
 *
 * A TerminateMicrovm call that fails does not fail the operation. The
 * operation logs the error and returns the job's result. So the execution
 * history shows a successful terminate step either way. This check reads the
 * MicroVM state instead.
 *
 * TerminateMicrovm returns before the state changes, and the API does not
 * document how soon GetMicrovm reports the change. So the check reads the
 * state until it is TERMINATING or TERMINATED, for up to 30 seconds. A
 * MicroVM that is still running after that fails the test.
 */
export async function expectMicrovmTerminated(microvmId: string) {
  const client = new LambdaMicrovmsClient({});
  const deadline = Date.now() + TIMEOUT_MS;
  let state: string | undefined;
  try {
    for (;;) {
      try {
        const microvm = await client.send(
          new GetMicrovmCommand({ microvmIdentifier: microvmId }),
        );
        state = microvm.state;
      } catch (error) {
        // A MicroVM that GetMicrovm does not find is not running either.
        if (error instanceof ResourceNotFoundException) {
          return;
        }
        throw error;
      }
      if (
        (state !== undefined && ENDED_STATES.includes(state)) ||
        Date.now() > deadline
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    expect(ENDED_STATES).toContain(state);
  } finally {
    client.destroy();
  }
}

/**
 * Waits until GetMicrovm reports `expectedState`.
 *
 * Returns the states that GetMicrovm reported, in order, with each run of one
 * state reported once.
 *
 * The check reads the state every 2 seconds, for up to 150 seconds by
 * default. A MicroVM that ends, or that GetMicrovm does not find, cannot
 * reach the state any more. So the check fails at once in that case. A
 * MicroVM in another state after the timeout fails the check too.
 */
export async function waitForMicrovmState(
  microvmId: string,
  expectedState: string,
  { timeoutMs = STATE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<string[]> {
  const client = new LambdaMicrovmsClient({});
  const observed: string[] = [];
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      let state: string | undefined;
      try {
        const microvm = await client.send(
          new GetMicrovmCommand({ microvmIdentifier: microvmId }),
        );
        state = microvm.state;
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          throw new Error(
            `GetMicrovm did not find MicroVM ${microvmId} before it was ` +
              `${expectedState}. States seen: ${JSON.stringify(observed)}`,
          );
        }
        throw error;
      }
      const reported = state ?? "UNKNOWN";
      if (observed[observed.length - 1] !== reported) {
        observed.push(reported);
      }
      if (state === expectedState) {
        return observed;
      }
      if (state !== undefined && ENDED_STATES.includes(state)) {
        throw new Error(
          `MicroVM ${microvmId} is ${state} before it was ${expectedState}. ` +
            `States seen: ${JSON.stringify(observed)}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `MicroVM ${microvmId} was not ${expectedState} within ` +
            `${Math.round(timeoutMs / 1000)} seconds. ` +
            `States seen: ${JSON.stringify(observed)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    client.destroy();
  }
}
