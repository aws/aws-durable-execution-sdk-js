import { InvalidParameterValueException } from "@aws-sdk/client-lambda";
import {
  Operation,
  OperationAction,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

/**
 * Validates a FETCH operation update against the current operation state.
 *
 * A fetch is one-sided, like a chained invoke: the SDK only ever asks the service to START
 * it, and the service is the one that records the outcome. Every other action is rejected —
 * `SUCCEED` and `FAIL` because accepting them would let an execution fabricate a response it
 * never received, and `CANCEL` because the service does not offer it. This matches
 * `ValidActionsByOperationTypeValidator` in `DurableExecutionsWorkerService`, where
 * `VALID_ACTIONS_FOR_CHAINED_INVOKE` is `START` alone.
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
    default:
      throw new InvalidParameterValueException({
        message: "Invalid FETCH action.",
        $metadata: {},
      });
  }
}
