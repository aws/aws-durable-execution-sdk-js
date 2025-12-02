import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { validateCallbackOperation } from "../validate-callback-operation";

describe("validateCallbackOperation", () => {
  const createOperationUpdate = (action: OperationAction): OperationUpdate => ({
    Action: action,
    Type: OperationType.CALLBACK,
    Id: "test-id",
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.CALLBACK,
    Id: "test-id",
    StartTimestamp: undefined,
  });

  describe("START action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateCallbackOperation(update, undefined);
      }).not.toThrow();
    });

    it("should throw exception when operation already exists", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateCallbackOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCallbackOperation(update, currentOperation);
      }).toThrow("Cannot start a CALLBACK that already exists.");
    });
  });

  describe("CANCEL action", () => {
    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateCallbackOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateCallbackOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCallbackOperation(update, undefined);
      }).toThrow(
        "Cannot cancel a CALLBACK that does not exist or has already completed.",
      );
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const update = createOperationUpdate(OperationAction.CANCEL);

      expect(() => {
        validateCallbackOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCallbackOperation(update, currentOperation);
      }).toThrow(
        "Cannot cancel a CALLBACK that does not exist or has already completed.",
      );
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.CALLBACK,
        Id: "test-id",
      };

      expect(() => {
        validateCallbackOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCallbackOperation(update, undefined);
      }).toThrow("Invalid CALLBACK action.");
    });
  });
});
