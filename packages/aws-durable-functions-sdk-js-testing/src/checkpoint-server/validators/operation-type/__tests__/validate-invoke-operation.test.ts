import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@amzn/dex-internal-sdk";
import { validateInvokeOperation } from "../validate-invoke-operation";

describe("validateInvokeOperation", () => {
  const createOperationUpdate = (action: OperationAction): OperationUpdate => ({
    Action: action,
    Type: OperationType.INVOKE,
    Id: "test-id",
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.INVOKE,
    Id: "test-id",
  });

  describe("START action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateInvokeOperation(update, undefined);
      }).not.toThrow();
    });

    it("should throw exception when operation already exists", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateInvokeOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateInvokeOperation(update, currentOperation);
      }).toThrow("Cannot start an INVOKE that already exists.");
    });
  });

  describe("CANCEL action", () => {
    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateInvokeOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateInvokeOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateInvokeOperation(update, undefined);
      }).toThrow("Cannot cancel an INVOKE that does not exist or has already completed.");
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateInvokeOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateInvokeOperation(update, currentOperation);
      }).toThrow("Cannot cancel an INVOKE that does not exist or has already completed.");
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.INVOKE,
        Id: "test-id",
      };

      expect(() => {
        validateInvokeOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateInvokeOperation(update, undefined);
      }).toThrow("Invalid INVOKE action.");
    });
  });
});
