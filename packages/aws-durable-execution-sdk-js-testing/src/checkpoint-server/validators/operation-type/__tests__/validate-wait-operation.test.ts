import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { validateWaitOperation } from "../validate-wait-operation";

describe("validateWaitOperation", () => {
  const createOperationUpdate = (action: OperationAction): OperationUpdate => ({
    Action: action,
    Type: OperationType.WAIT,
    Id: "test-id",
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.WAIT,
    Id: "test-id",
  });

  describe("START action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateWaitOperation(update, undefined);
      }).not.toThrow();
    });

    it("should throw exception when operation already exists", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateWaitOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateWaitOperation(update, currentOperation);
      }).toThrow("Cannot start a WAIT that already exists.");
    });
  });

  describe("CANCEL action", () => {
    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateWaitOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateWaitOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateWaitOperation(update, undefined);
      }).toThrow("Cannot cancel a WAIT that does not exist or has already completed.");
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateWaitOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateWaitOperation(update, currentOperation);
      }).toThrow("Cannot cancel a WAIT that does not exist or has already completed.");
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.WAIT,
        Id: "test-id",
      };

      expect(() => {
        validateWaitOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateWaitOperation(update, undefined);
      }).toThrow("Invalid WAIT action.");
    });
  });
});
