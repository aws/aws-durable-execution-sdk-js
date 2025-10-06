import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { validateChainedInvokeOperation } from "../validate-chained-invoke-operation";

describe("validateInvokeOperation", () => {
  const createOperationUpdate = (action: OperationAction): OperationUpdate => ({
    Action: action,
    Type: OperationType.CHAINED_INVOKE,
    Id: "test-id",
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.CHAINED_INVOKE,
    Id: "test-id",
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
      }).toThrow("Cannot start a CHAINED_INVOKE that already exists.");
    });
  });

  describe("CANCEL action", () => {
    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).toThrow(
        "Cannot cancel a CHAINED_INVOKE that does not exist or has already completed.",
      );
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateChainedInvokeOperation(update, currentOperation);
      }).toThrow(
        "Cannot cancel a CHAINED_INVOKE that does not exist or has already completed.",
      );
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.CHAINED_INVOKE,
        Id: "test-id",
      };

      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateChainedInvokeOperation(update, undefined);
      }).toThrow("Invalid CHAINED_INVOKE action.");
    });
  });
});
