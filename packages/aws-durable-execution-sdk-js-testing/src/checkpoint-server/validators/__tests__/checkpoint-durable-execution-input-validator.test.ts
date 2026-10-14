import { InvalidParameterValueException } from "@aws-sdk/client-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
  ErrorObject,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
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
      }).toThrow(
        "Error object size must be less than or equal to 262144 bytes.",
      );
    });

    it("should accept an error just under the limit", () => {
      const update: OperationUpdate = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.FAIL,
        Error: { ErrorMessage: "" },
      };
      const overhead = Buffer.byteLength(JSON.stringify(update));
      update.Error = { ErrorMessage: "a".repeat(262144 - overhead) };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();

      update.Error = { ErrorMessage: "a".repeat(262144 - overhead + 1) };
      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(
        "Error object size must be less than or equal to 262144 bytes.",
      );
    });
  });

  describe("validation order", () => {
    // The service reads the body before it checks the model. So a member of
    // the wrong type is reported before an invalid member of another update.
    it("reports a wrong type before a model constraint", () => {
      expect(() => {
        validateCheckpointUpdates(
          [
            {
              Id: "bad id!",
              Type: OperationType.STEP,
              Action: OperationAction.START,
            },
            {
              Id: "op2",
              Type: OperationType.STEP,
              Action: OperationAction.START,
              Name: 1 as unknown as string,
            },
          ],
          mockOperations,
        );
      }).toThrow(
        expect.objectContaining({
          name: "SerializationException",
          message: "NUMBER_VALUE can not be converted to a String",
        }),
      );
    });
  });

  describe("payload size validation", () => {
    it.each([
      [
        OperationType.STEP,
        OperationAction.SUCCEED,
        262144,
        "STEP output payload",
      ],
      [
        OperationType.CONTEXT,
        OperationAction.SUCCEED,
        262144,
        "CONTEXT output payload",
      ],
      [
        OperationType.CHAINED_INVOKE,
        OperationAction.START,
        1048576,
        "CHAINED_INVOKE input payload",
      ],
      [
        OperationType.EXECUTION,
        OperationAction.SUCCEED,
        6291456,
        "Execution output payload",
      ],
    ] satisfies [OperationType, OperationAction, number, string][])(
      "should limit a %s payload to %s bytes",
      (type, action, maxBytes, description) => {
        const update = (Payload: string): OperationUpdate => ({
          Id: "op1",
          Type: type,
          Action: action,
          Payload,
          ChainedInvokeOptions:
            type === OperationType.CHAINED_INVOKE
              ? { FunctionName: "child-function" }
              : undefined,
        });

        expect(() => {
          validateCheckpointUpdates(
            [update("a".repeat(maxBytes))],
            mockOperations,
          );
        }).not.toThrow();
        expect(() => {
          validateCheckpointUpdates(
            [update("a".repeat(maxBytes + 1))],
            mockOperations,
          );
        }).toThrow(
          new InvalidParameterValueException({
            message: `${description} size must be less than or equal to ${maxBytes} bytes.`,
            $metadata: {},
          }),
        );
      },
    );

    it("should count the UTF-8 bytes of the payload", () => {
      // "é" is 2 bytes in UTF-8, so this payload is 262146 bytes.
      const update: OperationUpdate = {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.SUCCEED,
        Payload: "é".repeat(131073),
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow("STEP output payload size must be less than or equal to");
    });

    it("should not limit a WAIT payload", () => {
      const update: OperationUpdate = {
        Id: "op1",
        Type: OperationType.WAIT,
        Action: OperationAction.START,
        Payload: "a".repeat(262145),
        WaitOptions: { WaitSeconds: 1 },
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });
  });

  describe("operation metadata consistency validation", () => {
    const existingStep = (): CheckpointOperation => ({
      operation: {
        Id: "op1",
        Type: OperationType.STEP,
        SubType: "Step",
        Name: "charge",
        ParentId: "parent",
        Status: OperationStatus.STARTED,
        StartTimestamp: undefined,
      },
      update: {
        Id: "op1",
        Type: OperationType.STEP,
        Action: OperationAction.START,
      },
      events: [],
    });

    beforeEach(() => {
      mockOperations.set("parent", {
        ...createCheckpointOperation(
          OperationType.CONTEXT,
          OperationStatus.STARTED,
        ),
      });
      mockOperations.set("other-parent", {
        ...createCheckpointOperation(
          OperationType.CONTEXT,
          OperationStatus.STARTED,
        ),
      });
      mockOperations.set("op1", existingStep());
    });

    it("should accept an update that repeats the existing values", () => {
      expect(() => {
        validateCheckpointUpdates(
          [
            {
              Id: "op1",
              Type: OperationType.STEP,
              SubType: "Step",
              Name: "charge",
              ParentId: "parent",
              Action: OperationAction.SUCCEED,
            },
          ],
          mockOperations,
        );
      }).not.toThrow();
    });

    it("should accept an update that omits the values", () => {
      expect(() => {
        validateCheckpointUpdates(
          [
            {
              Id: "op1",
              Type: OperationType.STEP,
              Action: OperationAction.SUCCEED,
            },
          ],
          mockOperations,
        );
      }).not.toThrow();
    });

    it.each([
      ["Type", { Type: OperationType.CONTEXT }],
      ["SubType", { SubType: "Other" }],
      ["Name", { Name: "refund" }],
      ["ParentId", { ParentId: "other-parent" }],
    ] satisfies [string, Partial<OperationUpdate>][])(
      "should reject a different %s",
      (field, fields) => {
        expect(() => {
          validateCheckpointUpdates(
            [
              {
                Id: "op1",
                Type: OperationType.STEP,
                Action: OperationAction.SUCCEED,
                ...fields,
              },
            ],
            mockOperations,
          );
        }).toThrow(
          new InvalidParameterValueException({
            message: `${field} value in OperationUpdate is inconsistent with existing operation. Check for non-determinism.`,
            $metadata: {},
          }),
        );
      },
    );

    // The service compares an update with the operation stored before the
    // request. It does not compare the updates of one request with each
    // other. So a START and a SUCCEED with different names in one request
    // pass this check, as they do in the service.
    it("should not compare updates within the same request", () => {
      expect(() => {
        validateCheckpointUpdates(
          [
            {
              Id: "op2",
              Type: OperationType.STEP,
              Name: "charge",
              Action: OperationAction.START,
            },
            {
              Id: "op2",
              Type: OperationType.STEP,
              Name: "refund",
              Action: OperationAction.SUCCEED,
            },
          ],
          mockOperations,
        );
      }).not.toThrow();
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
        createCheckpointOperation(
          OperationType.EXECUTION,
          OperationStatus.STARTED,
        ),
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
      }).toThrow(
        expect.objectContaining({
          name: "ValidationException",
          message:
            "1 validation error detected: Value null at 'updates.1.member.id' failed to satisfy constraint: Member must not be null",
        }),
      );
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
      }).toThrow("Invalid operation type.");
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

    it("should throw a model validation error for a null operation type", () => {
      const update = {
        Id: "op1",
        Type: null as unknown as OperationType,
        Action: OperationAction.START,
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).toThrow(
        expect.objectContaining({
          name: "ValidationException",
          message:
            "1 validation error detected: Value null at 'updates.1.member.type' failed to satisfy constraint: Member must not be null",
        }),
      );
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
    }).toThrow("Invalid operation type.");
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
        WaitOptions: { WaitSeconds: 1 },
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
        ChainedInvokeOptions: { FunctionName: "child-function" },
      };

      expect(() => {
        validateCheckpointUpdates([update], mockOperations);
      }).not.toThrow();
    });
  });
});
