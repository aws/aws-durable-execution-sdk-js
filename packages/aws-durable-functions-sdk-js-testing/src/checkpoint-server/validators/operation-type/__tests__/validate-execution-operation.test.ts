import {
  InvalidParameterValueException,
  OperationAction,
  OperationType,
  OperationUpdate,
  ErrorObject,
} from "@amzn/dex-internal-sdk";
import { validateExecutionOperation } from "../validate-execution-operation";

describe("validateExecutionOperation", () => {
  const createOperationUpdate = (
    action: OperationAction,
    payload?: string,
    error?: ErrorObject
  ): OperationUpdate => ({
    Action: action,
    Type: OperationType.EXECUTION,
    Id: "test-id",
    Payload: payload,
    Error: error,
  });

  describe("SUCCEED action", () => {
    it("should succeed", () => {
      const update = createOperationUpdate(OperationAction.SUCCEED);

      expect(() => {
        validateExecutionOperation(update);
      }).not.toThrow();
    });

    it("should throw exception when error is provided", () => {
      const errorObject: ErrorObject = {
        ErrorType: "TestError",
        StackTrace: ["test stack trace"],
      };
      const update = createOperationUpdate(OperationAction.SUCCEED, undefined, errorObject);

      expect(() => {
        validateExecutionOperation(update);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateExecutionOperation(update);
      }).toThrow("Cannot provide an Error for SUCCEED action.");
    });
  });

  describe("FAIL action", () => {
    it("should succeed", () => {
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateExecutionOperation(update);
      }).not.toThrow();
    });

    it("should throw exception when payload is provided", () => {
      const update = createOperationUpdate(OperationAction.FAIL, "test-payload");

      expect(() => {
        validateExecutionOperation(update);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateExecutionOperation(update);
      }).toThrow("Cannot provide a Payload for FAIL action.");
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.EXECUTION,
        Id: "test-id",
      };

      expect(() => {
        validateExecutionOperation(update);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateExecutionOperation(update);
      }).toThrow("Invalid EXECUTION action.");
    });
  });
});
