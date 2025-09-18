import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import { validateContextOperation } from "../validate-context-operation";

describe("validateContextOperation", () => {
  const createOperationUpdate = (
    action: OperationAction,
    payload?: string,
    error?: ErrorObject
  ): OperationUpdate => ({
    Action: action,
    Type: OperationType.CONTEXT,
    Id: "test-id",
    Payload: payload,
    Error: error,
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.CONTEXT,
    Id: "test-id",
  });

  describe("START action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateContextOperation(update, undefined);
      }).not.toThrow();
    });

    it("should throw exception when operation already exists", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateContextOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateContextOperation(update, currentOperation);
      }).toThrow("Cannot start a CONTEXT that already exists.");
    });
  });

  describe("FAIL action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateContextOperation(update, undefined);
      }).not.toThrow();
    });

    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateContextOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateContextOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateContextOperation(update, currentOperation);
      }).toThrow("Invalid current CONTEXT state to close.");
    });

    it("should throw exception when payload is provided", () => {
      const update = createOperationUpdate(
        OperationAction.FAIL,
        "test-payload"
      );

      expect(() => {
        validateContextOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateContextOperation(update, undefined);
      }).toThrow("Cannot provide a Payload for FAIL action.");
    });
  });

  describe("SUCCEED action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.SUCCEED);

      expect(() => {
        validateContextOperation(update, undefined);
      }).not.toThrow();
    });

    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.SUCCEED);

      expect(() => {
        validateContextOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.FAILED);
      const update = createOperationUpdate(OperationAction.SUCCEED);

      expect(() => {
        validateContextOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateContextOperation(update, currentOperation);
      }).toThrow("Invalid current CONTEXT state to close.");
    });

    it("should throw exception when error is provided", () => {
      const errorObject: ErrorObject = {
        ErrorType: "TestError",
        StackTrace: ["test stack trace"],
      };
      const update = createOperationUpdate(
        OperationAction.SUCCEED,
        undefined,
        errorObject
      );

      expect(() => {
        validateContextOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateContextOperation(update, undefined);
      }).toThrow("Cannot provide an Error for SUCCEED action.");
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.CONTEXT,
        Id: "test-id",
      };

      expect(() => {
        validateContextOperation(update, undefined);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateContextOperation(update, undefined);
      }).toThrow("Invalid CONTEXT action.");
    });
  });
});
