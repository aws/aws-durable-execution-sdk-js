import { InvalidParameterValueException } from "@aws-sdk/client-lambda";
import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
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
      }).toThrow("Cannot start a CALLBACK operation that already exists.");
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
        validateCallbackOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCallbackOperation(update, currentOperation);
      }).toThrow("Invalid action for CALLBACK operation.");
    });
  });
});
