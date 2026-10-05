import {
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";

/**
 * Expects that the operation terminated the MicroVM.
 *
 * A TerminateMicrovm call that fails does not fail the operation. The
 * operation logs the error and returns the job's result. So the execution
 * history shows a successful terminate step either way. This check reads the
 * MicroVM state instead. A MicroVM that is still running fails the test.
 */
export async function expectMicrovmTerminated(microvmId: string) {
  const client = new LambdaMicrovmsClient({});
  try {
    const microvm = await client.send(
      new GetMicrovmCommand({ microvmIdentifier: microvmId }),
    );
    expect(["TERMINATING", "TERMINATED"]).toContain(microvm.state);
  } catch (error) {
    // A MicroVM that GetMicrovm does not find is not running either.
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  } finally {
    client.destroy();
  }
}
