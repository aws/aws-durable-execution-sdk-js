import { DurableOperationError } from "@aws/durable-execution-sdk-js";
import { ComputeError as RootComputeError } from "../../..";
import {
  ComputeError,
  MicrovmDeliveryError,
  MicrovmEndpointUnavailableError,
  MicrovmError,
  MicrovmJobFailedError,
  MicrovmLaunchError,
  MicrovmNotRunningError,
  MicrovmRequestRejectedError,
  MicrovmRequestUnauthorizedError,
  MicrovmTimeoutError,
} from "..";

/** Every error class that the compute/microvm subpath exports. */
const OPERATION_ERRORS = [
  MicrovmError,
  MicrovmLaunchError,
  MicrovmDeliveryError,
  MicrovmNotRunningError,
  MicrovmJobFailedError,
  MicrovmTimeoutError,
];

/** The errors that the request step throws for its retry strategy. */
const REQUEST_ERRORS = [
  new MicrovmRequestRejectedError("rejected", 404),
  new MicrovmRequestUnauthorizedError("unauthorized", 403),
  new MicrovmEndpointUnavailableError("unavailable"),
];

describe("compute error hierarchy", () => {
  it("exports one ComputeError class from the root and the subpath", () => {
    expect(RootComputeError).toBe(ComputeError);
  });

  it.each(OPERATION_ERRORS.map((Class) => [Class.name, Class] as const))(
    "%s extends MicrovmError, ComputeError, and DurableOperationError",
    (name, Class) => {
      const error = new Class("failed");

      expect(error).toBeInstanceOf(MicrovmError);
      expect(error).toBeInstanceOf(ComputeError);
      expect(error).toBeInstanceOf(DurableOperationError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
      // The checkpointed type is the class name, as before the ComputeError base.
      expect(error.errorType).toBe(name);
      expect(error.toErrorObject().ErrorType).toBe(name);
    },
  );

  it.each(REQUEST_ERRORS.map((error) => [error.name, error] as const))(
    "%s extends MicrovmDeliveryError and keeps its checkpointed type",
    (name, error) => {
      expect(error).toBeInstanceOf(MicrovmDeliveryError);
      expect(error).toBeInstanceOf(ComputeError);
      expect(error.name).toBe(name);
      // Before it extended MicrovmDeliveryError, the SDK checkpointed a plain
      // Error by its name. The type stays the same, so a replay of a step that
      // failed on an earlier build finds the same type.
      expect(error.errorType).toBe(name);
      expect(error.toErrorObject()).toMatchObject({
        ErrorType: name,
        ErrorMessage: error.message,
        ErrorData: undefined,
      });
    },
  );

  it("keeps the HTTP status on the request errors", () => {
    expect(new MicrovmRequestRejectedError("rejected", 404).status).toBe(404);
    expect(
      new MicrovmRequestUnauthorizedError("unauthorized", 403).status,
    ).toBe(403);
  });
});
