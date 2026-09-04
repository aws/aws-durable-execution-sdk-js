import { InvalidParameterValueException } from "@aws-sdk/client-lambda";
import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

const allowedStatusToCancel: (OperationStatus | undefined)[] = [
  OperationStatus.STARTED,
];

/**
 * Validates a FETCH operation update against the current operation state.
 *
 * A fetch is one-sided, like a chained invoke: the SDK only ever asks the service to START
 * it, and the service is the one that records the outcome. `SUCCEED` and `FAIL` from the SDK
 * are therefore rejected — accepting them would let an execution fabricate a response it
 * never received.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateFetchOperation(
  update: OperationUpdate,
  operation: Operation | undefined,
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw new InvalidParameterValueException({
          message: "Cannot start a FETCH that already exists.",
          $metadata: {},
        });
      }
      if (!update.FetchOptions?.Url) {
        throw new InvalidParameterValueException({
          message: "Cannot start a FETCH without a Url.",
          $metadata: {},
        });
      }
      break;
    case OperationAction.CANCEL:
      if (!operation || !allowedStatusToCancel.includes(operation.Status)) {
        throw new InvalidParameterValueException({
          message:
            "Cannot cancel a FETCH that does not exist or has already completed.",
          $metadata: {},
        });
      }
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Invalid FETCH action.",
        $metadata: {},
      });
  }
}
