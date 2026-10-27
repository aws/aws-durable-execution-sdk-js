import { InvalidParameterValueException } from "@aws-sdk/client-lambda";
import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { validateChainedInvokeOperation } from "../validate-chained-invoke-operation";

describe("validateInvokeOperation", () => {
  const createOperationUpdate = (action: OperationAction): OperationUpdate => ({
    Action: action,
    Type: OperationType.CHAINED_INVOKE,
    Id: "test-id",
    ChainedInvokeOptions: { FunctionName: "child-function" },
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.CHAINED_INVOKE,
    Id: "test-id",
    StartTimestamp: undefined,
  });

  describe("START action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).not.toThrow();
    });

    it("should throw exception when operation already exists", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).toThrow(
        "Cannot start a CHAINED_INVOKE operation that already exists.",
      );
    });

    it("should throw exception when ChainedInvokeOptions is missing", () => {
      const update: OperationUpdate = {
        ...createOperationUpdate(OperationAction.START),
        ChainedInvokeOptions: undefined,
      };

      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).toThrow(
        "Update for CHAINED_INVOKE operation requires ChainedInvokeOptions.",
      );
    });
  });

  describe("Invalid action", () => {
    it.each([
      OperationAction.CANCEL,
      OperationAction.SUCCEED,
      "INVALID_ACTION" as OperationAction,
    ])("should throw exception for %s", (action) => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(action);

      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).toThrow("Invalid action for CHAINED_INVOKE operation.");
    });
  });
});
