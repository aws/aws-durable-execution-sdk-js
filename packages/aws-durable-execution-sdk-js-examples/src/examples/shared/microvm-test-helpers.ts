import {
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";

const ENDED_STATES = ["TERMINATING", "TERMINATED"];
const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = 30_000;

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
