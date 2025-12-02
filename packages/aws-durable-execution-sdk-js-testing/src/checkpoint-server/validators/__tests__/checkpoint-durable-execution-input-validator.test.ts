import {
  InvalidParameterValueException,
  OperationAction,
  OperationStatus,
  OperationType,
  ErrorObject,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { validateCheckpointUpdates } from "../checkpoint-durable-execution-input-validator";
import { CheckpointOperation } from "../../storage/checkpoint-manager";

describe("validateCheckpointUpdates", () => {
  let mockOperations: Map<string, CheckpointOperation>;

  beforeEach(() => {
    mockOperations = new Map();
  });

  const createCheckpointOperation = (
    type: OperationType,
    status: OperationStatus,
  ): CheckpointOperation => ({
    operation: {
      Type: type,
      Status: status,
      Id: "test-id",
      StartTimestamp: undefined,
    },
    update: {
      Id: "test-id",
      Type: type,
      Action: OperationAction.START,
    },
    events: [],
  });

  describe("null/empty updates", () => {
    it("should succeed with null updates", () => {
      expect(() => {
        validateCheckpointUpdates(undefined, mockOperations);
      }).not.toThrow();
    });

    it("should succeed with empty updates", () => {
      expect(() => {
        validateCheckpointUpdates([], mockOperations);
      }).not.toThrow();
    });
  });

  describe("error size validation", () => {
    it("should throw exception when error is too large", () => {
      const largeError: ErrorObject = {
        ErrorType: "a".repeat(140000),
        StackTrace: ["b".repeat(140000)],
      };
      const update = {
        Id: "op1",
        Type: OperationType.EXECUTION,
        Action: OperationAction.FAIL,
        Error: largeError,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Error object size must be less than 32768 bytes.");
    });
  });

  describe("execution operation validation", () => {
    it("should throw exception with multiple execution updates", () => {
      const update1 = {
        Id: "op1",
        Type: OperationType.EXECUTION,
        Action: OperationAction.SUCCEED,
      };
      const update2 = {
        Id: "op2",
        Type: OperationType.EXECUTION,
        Action: OperationAction.FAIL,
      };

      expect(() => {
        validateCheckpointUpdates([update1, update2], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update1, update2], mockOperations);
      }).toThrow("Cannot checkpoint multiple EXECUTION updates.");
    });

    it("should throw exception when execution is not the last update", () => {
      const executionUpdate = {
        Id: "op1",
        Type: OperationType.EXECUTION,
        Action: OperationAction.SUCCEED,
      };
      const stepUpdate = {
        Id: "op2",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates(
          [executionUpdate, stepUpdate],
          mockOperations,
        );
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates(
          [executionUpdate, stepUpdate],
          mockOperations,
        );
      }).toThrow("EXECUTION checkpoint must be the last update.");
    });

    it("should succeed with single execution operation", () => {
      mockOperations.set(
        "op1",
        createCheckpointOperation(
          OperationType.EXECUTION,
          OperationStatus.STARTED,
        ),
      );
      const update = {
        Id: "op1",
        Type: OperationType.EXECUTION,
        Action: OperationAction.SUCCEED,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should succeed with execution fail operation", () => {
      mockOperations.set(
        "op1",
        createCheckpointOperation(OperationType.STEP, OperationStatus.STARTED),
      );
      const update = {
        Id: "op1",
        Type: OperationType.EXECUTION,
        Action: OperationAction.FAIL,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });
  });

  describe("parent operation validation", () => {
    it("should throw exception with invalid parent", () => {
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "invalidParent",
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Invalid parent operation id.");
    });

    it("should succeed with parent in same request", () => {
      const parentUpdate = {
        Id: "parentId",
        Type: OperationType.CONTEXT,
        Action: OperationAction.START,
      };
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([parentUpdate, update], mockOperations);
      }).not.toThrow();
    });

    it("should throw exception with non-context parent in same request", () => {
      const parentUpdate = {
        Id: "parentId",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([parentUpdate, update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([parentUpdate, update], mockOperations);
      }).toThrow("Invalid parent operation id.");
    });

    it("should succeed with context parent in same request", () => {
      const parentUpdate = {
        Id: "parentId",
        Type: OperationType.CONTEXT,
        Action: OperationAction.START,
      };
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([parentUpdate, update], mockOperations);
      }).not.toThrow();
    });

    it("should throw exception with non-context parent in state", () => {
      mockOperations.set(
        "parentId",
        createCheckpointOperation(OperationType.STEP, OperationStatus.STARTED),
      );
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Invalid parent operation id.");
    });

    it("should succeed with context parent in state", () => {
      mockOperations.set(
        "parentId",
        createCheckpointOperation(
          OperationType.CONTEXT,
          OperationStatus.STARTED,
        ),
      );
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should throw exception when parent comes after child", () => {
      const parentUpdate = {
        Id: "parentId",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([update, parentUpdate], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update, parentUpdate], mockOperations);
      }).toThrow("Invalid parent operation id.");
    });

    it("should throw exception when parent id equals operation id", () => {
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "op1",
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Invalid parent operation id.");
    });

    it("should succeed with valid parent", () => {
      mockOperations.set(
        "parentId",
        createCheckpointOperation(
          OperationType.CONTEXT,
          OperationStatus.STARTED,
        ),
      );
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "parentId",
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should throw exception when parent id does not exist anywhere", () => {
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
        ParentId: "nonExistentParent",
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Invalid parent operation id.");
    });
  });

  describe("invalid operation validation", () => {
    it("should throw exception with invalid operation id", () => {
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update, update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update, update], mockOperations);
      }).toThrow("Cannot update the same operation twice in a single request.");
    });

    it.each([
      ["STEP", "START", "RETRY"],
      ["STEP", "START", "SUCCEED"],
      ["STEP", "START", "FAIL"],
      ["CONTEXT", "START", "SUCCEED"],
      ["CONTEXT", "START", "FAIL"],
    ] satisfies [OperationType, OperationAction, OperationAction][])(
      `should succeed with type=%s, firstUpdate=%s, secondUpdate=%s`,
      (type, firstAction, secondAction) => {
        const firstUpdate = {
          Id: "op1",
          Type: type,
          Action: firstAction,
        };
        const secondUpdate: OperationUpdate = {
          Id: "op2",
          Type: type,
          Action: secondAction,
        };

        if (secondAction === OperationAction.RETRY) {
          secondUpdate.StepOptions = {
            NextAttemptDelaySeconds: 10,
          };
        }

        expect(() => {
          validateCheckpointUpdates(
            [firstUpdate, secondUpdate],
            mockOperations,
          );
        }).not.toThrow();
      },
    );

    it.each([
      ["STEP", "START", "START"],
      ["STEP", "RETRY", "START"],
      ["STEP", "RETRY", "RETRY"],
      ["STEP", "RETRY", "SUCCEED"],
      ["STEP", "RETRY", "FAIL"],
      ["STEP", "SUCCEED", "START"],
      ["STEP", "SUCCEED", "RETRY"],
      ["STEP", "SUCCEED", "SUCCEED"],
      ["STEP", "SUCCEED", "FAIL"],
      ["STEP", "FAIL", "START"],
      ["STEP", "FAIL", "RETRY"],
      ["STEP", "FAIL", "SUCCEED"],
      ["STEP", "FAIL", "FAIL"],
      ["CONTEXT", "START", "START"],
      ["CONTEXT", "SUCCEED", "START"],
      ["CONTEXT", "SUCCEED", "RETRY"],
      ["CONTEXT", "SUCCEED", "SUCCEED"],
      ["CONTEXT", "SUCCEED", "FAIL"],
      ["CONTEXT", "FAIL", "START"],
      ["CONTEXT", "FAIL", "RETRY"],
      ["CONTEXT", "FAIL", "SUCCEED"],
      ["CONTEXT", "FAIL", "FAIL"],
    ] satisfies [OperationType, OperationAction, OperationAction][])(
      "should throw with type=%s, firstAction=%s, secondAction=%s",
      (type, firstAction, secondAction) => {
        const firstUpdate = {
          Id: "op1",
          Type: type,
          Action: firstAction,
        };
        const secondUpdate = {
          Id: "op1",
          Type: type,
          Action: secondAction,
        };

        expect(() => {
          validateCheckpointUpdates(
            [firstUpdate, secondUpdate],
            mockOperations,
          );
        }).toThrow(
          "Cannot update the same operation twice in a single request.",
        );
      },
    );
  });

  describe("operation id validation", () => {
    it("should throw exception when operation update has no id", () => {
      const update: OperationUpdate = {
        Type: OperationType.STEP,
        Action: OperationAction.START,
        Id: undefined,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Operation update must have an Id.");
    });
  });

  describe("operation type validation", () => {
    it("should throw exception with unknown operation type", () => {
      const update = {
        Id: "op1",
        Type: "UNKNOWN_TYPE" as OperationType,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Unknown operation type.");
    });

    it("should throw exception with invalid action for operation type", () => {
      const update = {
        Id: "op1",
        Type: OperationType.EXECUTION,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Invalid action for the given operation type.");
    });

    it("should throw exception for truly invalid operation type", () => {
      const update = {
        Id: "op1",
        Type: null as unknown as OperationType,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(InvalidParameterValueException);
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("Unknown operation type.");
    });
  });

  it("should throw exception when invalid operation type reaches status transition", () => {
    const update = {
      Id: "op1",
      Type: "NotValidOperationType" as unknown as OperationType,
      Action: OperationAction.START,
    };

    expect(() => {
      validateCheckpointUpdates([update], mockOperations);
    }).toThrow(InvalidParameterValueException);
    expect(() => {
      validateCheckpointUpdates([update], mockOperations);
    }).toThrow("Unknown operation type");
  });

  describe("valid operations", () => {
    it("should succeed with valid step operation", () => {
      const update = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should succeed with context operation", () => {
      const update = {
        Id: "op1",
        Type: OperationType.CONTEXT,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should succeed with wait operation", () => {
      const update = {
        Id: "op1",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should succeed with callback operation", () => {
      const update = {
        Id: "op1",
        Type: OperationType.CALLBACK,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });

    it("should succeed with invoke operation", () => {
      const update = {
        Id: "op1",
        Type: OperationType.CHAINED_INVOKE,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });
  });
});
