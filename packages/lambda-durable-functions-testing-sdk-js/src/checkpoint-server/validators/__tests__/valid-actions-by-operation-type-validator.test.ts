import {
  InvalidParameterValueException,
  OperationAction,
  OperationType,
} from "@aws-sdk/client-lambda";
import { validateValidActionsByOperationType } from "../valid-actions-by-operation-type-validator";

describe("validateValidActionsByOperationType", () => {
  const validActionsByOperationType = [
    // STEP operations
    [OperationType.STEP, OperationAction.START],
    [OperationType.STEP, OperationAction.FAIL],
    [OperationType.STEP, OperationAction.RETRY],
    [OperationType.STEP, OperationAction.SUCCEED],

    // CONTEXT operations
    [OperationType.CONTEXT, OperationAction.START],
    [OperationType.CONTEXT, OperationAction.FAIL],
    [OperationType.CONTEXT, OperationAction.SUCCEED],

    // WAIT operations
    [OperationType.WAIT, OperationAction.START],
    [OperationType.WAIT, OperationAction.CANCEL],

    // CALLBACK operations
    [OperationType.CALLBACK, OperationAction.START],
    [OperationType.CALLBACK, OperationAction.CANCEL],

    // INVOKE operations
    [OperationType.INVOKE, OperationAction.START],
    [OperationType.INVOKE, OperationAction.CANCEL],

    // EXECUTION operations
    [OperationType.EXECUTION, OperationAction.SUCCEED],
    [OperationType.EXECUTION, OperationAction.FAIL],
  ] as const;

  const invalidActionsByOperationType = [
    // Invalid STEP actions
    [OperationType.STEP, OperationAction.CANCEL],

    // Invalid CONTEXT actions
    [OperationType.CONTEXT, OperationAction.CANCEL],
    [OperationType.CONTEXT, OperationAction.RETRY],

    // Invalid WAIT actions
    [OperationType.WAIT, OperationAction.FAIL],
    [OperationType.WAIT, OperationAction.SUCCEED],
    [OperationType.WAIT, OperationAction.RETRY],

    // Invalid CALLBACK actions
    [OperationType.CALLBACK, OperationAction.FAIL],
    [OperationType.CALLBACK, OperationAction.SUCCEED],
    [OperationType.CALLBACK, OperationAction.RETRY],

    // Invalid INVOKE actions
    [OperationType.INVOKE, OperationAction.FAIL],
    [OperationType.INVOKE, OperationAction.SUCCEED],
    [OperationType.INVOKE, OperationAction.RETRY],

    // Invalid EXECUTION actions
    [OperationType.EXECUTION, OperationAction.START],
    [OperationType.EXECUTION, OperationAction.CANCEL],
    [OperationType.EXECUTION, OperationAction.RETRY],
  ] as const;

  describe("valid actions", () => {
    it.each(validActionsByOperationType)(
      "should succeed for %s with %s action",
      (operationType, action) => {
        expect(() => {
          validateValidActionsByOperationType(operationType, action);
        }).not.toThrow();
      }
    );
  });

  describe("invalid actions", () => {
    it.each(invalidActionsByOperationType)(
      "should throw exception for %s with %s action",
      (operationType, action) => {
        expect(() => {
          validateValidActionsByOperationType(operationType, action);
        }).toThrow(InvalidParameterValueException);
        expect(() => {
          validateValidActionsByOperationType(operationType, action);
        }).toThrow("Invalid action for the given operation type.");
      }
    );
  });

  describe("unknown operation type", () => {
    it("should throw exception for unknown operation type", () => {
      expect(() => {
        validateValidActionsByOperationType(
          "UNKNOWN_TYPE" as OperationType,
          OperationAction.START
        );
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateValidActionsByOperationType(
          "UNKNOWN_TYPE" as OperationType,
          OperationAction.START
        );
      }).toThrow("Unknown operation type.");
    });
  });
});
