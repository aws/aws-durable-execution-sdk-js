import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
  ErrorObject,
  StepOptions,
} from "@aws-sdk/client-lambda";
import { validateStepOperation } from "../validate-step-operation";

describe("validateStepOperation", () => {
  const createOperationUpdate = (
    action: OperationAction,
    payload?: string,
    error?: ErrorObject,
    stepOptions?: StepOptions
  ): OperationUpdate => ({
    Action: action,
    Type: OperationType.STEP,
    Id: "test-id",
    Payload: payload,
    Error: error,
    StepOptions: stepOptions,
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.STEP,
    Id: "test-id",
  });

  describe("START action", () => {
    it("should succeed when no current operation exists", () => {
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateStepOperation(update, undefined);
      }).not.toThrow();
    });

    it("should succeed when operation has READY status", () => {
      const currentOperation = createOperation(OperationStatus.READY);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.START);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Invalid current STEP state to start.");
    });
  });

  describe("FAIL action", () => {
    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should succeed when operation has READY status", () => {
      const currentOperation = createOperation(OperationStatus.READY);
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when payload is provided", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(
        OperationAction.FAIL,
        "test-payload"
      );

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Cannot provide a Payload for FAIL action.");
    });

    it("should throw exception when operation has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const update = createOperationUpdate(OperationAction.FAIL);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Invalid current STEP state to close.");
    });
  });

  describe("SUCCEED action", () => {
    it("should succeed when operation has STARTED status", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update = createOperationUpdate(OperationAction.SUCCEED);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should succeed when operation has READY status", () => {
      const currentOperation = createOperation(OperationStatus.READY);
      const update = createOperationUpdate(OperationAction.SUCCEED);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when error is provided", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
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
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Cannot provide an Error for SUCCEED action.");
    });
  });

  describe("RETRY action", () => {
    it("should succeed when operation has READY status", () => {
      const currentOperation = createOperation(OperationStatus.READY);
      const stepOptions: StepOptions = {};
      const update = createOperationUpdate(
        OperationAction.RETRY,
        undefined,
        undefined,
        stepOptions
      );

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should succeed when operation has STARTED status with payload", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const stepOptions: StepOptions = {};
      const update = createOperationUpdate(
        OperationAction.RETRY,
        "test-payload",
        undefined,
        stepOptions
      );

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).not.toThrow();
    });

    it("should throw exception when StepOptions is null", () => {
      const currentOperation = createOperation(OperationStatus.READY);
      const update = createOperationUpdate(OperationAction.RETRY);

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Invalid StepOptions for the given action.");
    });

    it("should throw exception when both payload and error are provided", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const errorObject: ErrorObject = {
        ErrorType: "TestError",
        StackTrace: ["test stack trace"],
      };
      const stepOptions: StepOptions = {};
      const update = createOperationUpdate(
        OperationAction.RETRY,
        "test-payload",
        errorObject,
        stepOptions
      );

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Cannot provide both error and payload to RETRY a STEP.");
    });

    it("should throw exception when retry has invalid status", () => {
      const currentOperation = createOperation(OperationStatus.SUCCEEDED);
      const stepOptions: StepOptions = {};
      const update = createOperationUpdate(
        OperationAction.RETRY,
        undefined,
        undefined,
        stepOptions
      );

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Invalid current STEP state to re-attempt.");
    });
  });

  describe("Invalid action", () => {
    it("should throw exception for invalid action", () => {
      const currentOperation = createOperation(OperationStatus.STARTED);
      const update: OperationUpdate = {
        Action: "INVALID_ACTION" as OperationAction,
        Type: OperationType.STEP,
        Id: "test-id",
      };

      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateStepOperation(update, currentOperation);
      }).toThrow("Invalid STEP action.");
    });
  });
});
