import { Operation, OperationStatus } from "@aws-sdk/client-lambda";
import { extractErrorFromOperation } from "./operation";

describe("extractErrorFromOperation", () => {
  const makeOperation = (
    status: OperationStatus,
    details?: Partial<
      Pick<
        Operation,
        "StepDetails" | "ChainedInvokeDetails" | "CallbackDetails"
      >
    >,
  ): Operation => ({
    Id: "op-1",
    Type: "STEP",
    StartTimestamp: new Date(),
    Status: status,
    ...details,
  });

  describe("returns an Error for terminal error statuses", () => {
    it.each([
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.TIMED_OUT,
    ])("extracts error from StepDetails when status is %s", (status) => {
      const operation = makeOperation(status, {
        StepDetails: { Error: { ErrorMessage: `step error for ${status}` } },
      });

      const error = extractErrorFromOperation(operation);

      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toBe(`step error for ${status}`);
    });

    it.each([
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.TIMED_OUT,
    ])(
      "extracts error from ChainedInvokeDetails when status is %s",
      (status) => {
        const operation = makeOperation(status, {
          ChainedInvokeDetails: {
            Error: { ErrorMessage: `invoke error for ${status}` },
          },
        });

        const error = extractErrorFromOperation(operation);

        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toBe(`invoke error for ${status}`);
      },
    );

    it.each([
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.TIMED_OUT,
    ])("extracts error from CallbackDetails when status is %s", (status) => {
      const operation = makeOperation(status, {
        CallbackDetails: {
          Error: { ErrorMessage: `callback error for ${status}` },
        },
      });

      const error = extractErrorFromOperation(operation);

      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toBe(`callback error for ${status}`);
    });

    it.each([
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.TIMED_OUT,
    ])(
      "prefers StepDetails over ChainedInvokeDetails and CallbackDetails when status is %s",
      (status) => {
        const operation = makeOperation(status, {
          StepDetails: { Error: { ErrorMessage: "step wins" } },
          ChainedInvokeDetails: { Error: { ErrorMessage: "invoke loses" } },
          CallbackDetails: { Error: { ErrorMessage: "callback loses" } },
        });

        const error = extractErrorFromOperation(operation);

        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toBe("step wins");
      },
    );

    it.each([
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.TIMED_OUT,
    ])(
      "returns undefined when no error data is present for status %s",
      (status) => {
        const operation = makeOperation(status);

        const error = extractErrorFromOperation(operation);

        expect(error).toBeUndefined();
      },
    );

    it.each([
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.TIMED_OUT,
    ])(
      "returns undefined when ErrorMessage is missing for status %s",
      (status) => {
        const operation = makeOperation(status, {
          StepDetails: { Error: {} },
        });

        const error = extractErrorFromOperation(operation);

        expect(error).toBeUndefined();
      },
    );
  });

  describe("returns undefined for non-error statuses", () => {
    it.each([
      OperationStatus.SUCCEEDED,
      OperationStatus.PENDING,
      OperationStatus.READY,
      OperationStatus.STARTED,
      OperationStatus.CANCELLED,
    ])(
      "returns undefined for status %s even if error data is present",
      (status) => {
        const operation = makeOperation(status, {
          StepDetails: { Error: { ErrorMessage: "should be ignored" } },
        });

        const error = extractErrorFromOperation(operation);

        expect(error).toBeUndefined();
      },
    );
  });
});
