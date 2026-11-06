import { randomUUID } from "crypto";
import { OperationStatus, OperationType } from "@aws/durable-execution-sdk-js";
import {
  DurableOperation,
  ExecutionStatus,
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import {
  expectMicrovmTerminated,
  waitForMicrovmState,
} from "../../shared/microvm-test-helpers";
import { handler } from "./microvm-session-suspend-after";

// The test can poll for SUSPENDED for 150 seconds. The MicroVM also boots,
// resumes, and terminates within the test. So the test needs more time than
// the 120-second default of the integration run.
const TEST_TIMEOUT_MS = 600_000;

type OperationTree = [
  string | undefined,
  OperationType | undefined,
  OperationStatus | undefined,
  OperationTree[],
];

/** Returns [name, type, status, children] for each operation, in order. */
function tree(operations: DurableOperation[]): OperationTree[] {
  return operations.map((operation) => [
    operation.getName(),
    operation.getType(),
    operation.getStatus(),
    tree(operation.getChildOperations() ?? []),
  ]);
}

const SUCCEEDED = OperationStatus.SUCCEEDED;

createTests({
  handler,
  // The local runner cannot launch a MicroVM.
  cloudOnly: true,
  // A RequestResponse Invoke returns only when the execution ends. The runner
  // then reads the history only after that. The test must complete the gate
  // while the execution waits for it. So the test invokes the function
  // asynchronously, and the runner reads the history while the execution
  // runs.
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it(
      "suspends the MicroVM after the first job and resumes it for the next",
      async () => {
        const key = randomUUID();

        const executionPromise = runner.run({ payload: { key } });

        // The test reads the MicroVM state while the gate is pending. So it
        // reads the MicroVM ID from the launch step of this execution. Other
        // tests launch MicroVMs from the same image at the same time. So a
        // list of the image's MicroVMs could name another test's MicroVM.
        const launch = runner.getOperation("suspend-after-session.launch");
        await launch.waitForData(WaitingOperationStatus.COMPLETED);
        const microvmId = (
          launch.getStepDetails()?.result as { microvmId?: string } | undefined
        )?.microvmId;
        if (!microvmId) {
          throw new Error("The launch step recorded no MicroVM ID.");
        }

        const gate = runner.getOperation("gate");
        let gateStarted = false;
        let gateCompleted = false;
        try {
          await gate.waitForData(WaitingOperationStatus.STARTED);
          gateStarted = true;

          // 1. The gate starts after the first job ends.
          // 2. The second job starts only after the test completes the gate.
          // 3. The session does not suspend when idle. So only the first
          //    job's suspendAfter can suspend the MicroVM.
          // 4. So a SUSPENDED state read now lies between the two jobs, and
          //    comes from suspendAfter.
          // The poll lasts at most 150 seconds. The gate times out after 5
          // minutes. So the gate stays pending for the whole poll. The state
          // can also pass through SUSPENDING. So the test requires only that
          // SUSPENDED is seen once.
          await waitForMicrovmState(microvmId, "SUSPENDED");

          await gate.sendCallbackSuccess();
          gateCompleted = true;
        } finally {
          // A failure before the gate completes leaves the execution waiting
          // for the gate, with the MicroVM still there. A callback failure
          // makes the session terminate the MicroVM now, instead of after the
          // gate's timeout. If the test fails before the gate starts, the
          // gate times out after 5 minutes. The session then terminates the
          // MicroVM.
          if (gateStarted && !gateCompleted) {
            // The call runs while the test's own error propagates. An error
            // from the call would replace that error. So the test logs it.
            await gate
              .sendCallbackFailure({
                ErrorType: "TestFailed",
                ErrorMessage:
                  "The test failed before it completed the callback.",
              })
              .catch((error: unknown) => {
                console.warn(
                  "Could not fail the gate callback after the test failed.",
                  error,
                );
              });
            // The runner reads the history until the execution ends. So the
            // test waits for the end, and no read outlives the test.
            await executionPromise.catch(() => undefined);
          }
        }

        const execution = await executionPromise;

        expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
        const result = execution.getResult() as {
          sessionMicrovmId: string;
          writtenBy: string;
          readBy: string;
          value: string;
        };
        // 1. GetMicrovm reported the MicroVM SUSPENDED while the gate was
        //    pending.
        // 2. The second job read the file that the first job wrote.
        // 3. A suspended MicroVM keeps its files.
        // So both jobs ran in the same MicroVM, before and after the suspend.
        expect(result.sessionMicrovmId).toBe(microvmId);
        expect(result.writtenBy).toBe(microvmId);
        expect(result.readBy).toBe(microvmId);
        expect(result.value).toBe(`written-by-${key}`);

        await expectMicrovmTerminated(microvmId);

        // The tree is the tree of the session example, with a callback in
        // place of the wait. The state check and the resume run inside the
        // second request step. So the tree shows them only as a request step
        // that succeeded after the suspend.
        const roots = execution
          .getOperations()
          .filter((operation) => operation.getParentId() === undefined);
        expect(tree(roots)).toEqual([
          [
            "suspend-after-session",
            OperationType.CONTEXT,
            SUCCEEDED,
            [
              [
                "suspend-after-session.session",
                OperationType.STEP,
                SUCCEEDED,
                [],
              ],
              [
                "suspend-after-session.launch",
                OperationType.STEP,
                SUCCEEDED,
                [],
              ],
              [
                "write",
                OperationType.CONTEXT,
                SUCCEEDED,
                [
                  ["write.callback", OperationType.CALLBACK, SUCCEEDED, []],
                  ["write.request", OperationType.STEP, SUCCEEDED, []],
                ],
              ],
              ["gate", OperationType.CALLBACK, SUCCEEDED, []],
              [
                "read",
                OperationType.CONTEXT,
                SUCCEEDED,
                [
                  ["read.callback", OperationType.CALLBACK, SUCCEEDED, []],
                  ["read.request", OperationType.STEP, SUCCEEDED, []],
                ],
              ],
              [
                "suspend-after-session.terminate",
                OperationType.STEP,
                SUCCEEDED,
                [],
              ],
            ],
          ],
        ]);

        // The session sets neither autoSuspendOnIdle nor an idle policy. So
        // the launch records no resume before delivery. suspendAfter is an
        // option of one job, and the launch checkpoint does not record it.
        expect(launch.getStepDetails()?.result).toMatchObject({
          delivery: "http",
          microvmId,
          resumeBeforeDelivery: false,
        });

        // A job can finish before the invocation that waits for it ends. The
        // invocation then continues, and the execution has one invocation
        // fewer.
        assertEventSignatures(execution, undefined, {
          invocationCompletedDifference: 1,
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
});
