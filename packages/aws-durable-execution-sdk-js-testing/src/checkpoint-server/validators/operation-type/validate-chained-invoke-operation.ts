import { invalidParameterValue } from "../invalid-parameter-value";
import {
  Operation,
  OperationAction,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

/**
 * Validates a CHAINED_INVOKE operation update against the current operation state.
 * A checkpoint can only start a CHAINED_INVOKE. The service completes it.
 *
 * The service also rejects a function in another account or another region.
 * Local function names are not ARNs, so this check does not apply here.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateChainedInvokeOperation(
  update: OperationUpdate,
  operation: Operation | undefined,
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw invalidParameterValue(
          "Cannot start a CHAINED_INVOKE operation that already exists.",
        );
      }
      if (update.ChainedInvokeOptions == null) {
        throw invalidParameterValue(
          "Update for CHAINED_INVOKE operation requires ChainedInvokeOptions.",
        );
      }
      break;
    default:
      throw invalidParameterValue(
        "Invalid action for CHAINED_INVOKE operation.",
      );
  }
}
