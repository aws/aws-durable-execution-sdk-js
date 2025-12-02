import {
  OperationType,
  OperationStatus,
  OperationUpdate,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { createExecutionId } from "../../utils/tagged-strings";
import { CheckpointManager } from "../checkpoint-manager";

jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

describe("checkpoint-manager updateOperation", () => {
  let storage: CheckpointManager;

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    storage.cleanup();
  });

  it("should update operation for WAIT and update history", () => {
    const initialOperation = storage.initialize();

    const newOperationData = {
      Type: OperationType.WAIT,
      Status: OperationStatus.SUCCEEDED,
      EndTimestamp: new Date(),
    };

    const result = storage.updateOperation(
      initialOperation.operation.Id,
      newOperationData,
      undefined,
      undefined,
    );

    // Should return the updated CheckpointOperation
    expect(result.operation.Id).toBe(initialOperation.operation.Id);
    expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED); // Updated status
    expect(result.operation.EndTimestamp).toEqual(
      newOperationData.EndTimestamp,
    );

    expect(result.events).toEqual([
      {
        EventType: "ExecutionStarted",
        SubType: undefined,
        EventId: 1,
        Id: "mocked-uuid",
        Name: undefined,
        EventTimestamp: expect.any(Date),
        ParentId: undefined,
        ExecutionStartedDetails: {
          Input: {
            Payload: "{}",
          },
          ExecutionTimeout: undefined,
        },
      },
      {
        EventType: "WaitSucceeded",
        SubType: undefined,
        EventId: 2,
        Id: "mocked-uuid",
        Name: undefined,
        EventTimestamp: expect.any(Date),
        ParentId: undefined,
        WaitSucceededDetails: { Duration: undefined },
      },
    ]);
  });

  describe("CHAINED_INVOKE operation updates", () => {
    describe("valid operation updates", () => {
      it("should update CHAINED_INVOKE operation with SUCCEEDED status and create history event", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.SUCCEEDED,
          EndTimestamp: new Date(),
          ChainedInvokeDetails: {
            Result: '{"success": true, "data": "test-result"}',
          },
        };

        const result = storage.updateOperation(
          "invoke-op",
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe("invoke-op");
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );
        expect(result.operation.ChainedInvokeDetails?.Result).toBe(
          '{"success": true, "data": "test-result"}',
        );

        // Should have added InvokeSucceeded event
        expect(result.events).toHaveLength(2); // Start event + Success event
        const successEvent = result.events[1];
        expect(successEvent.EventType).toBe("ChainedInvokeSucceeded");
        expect(successEvent.ChainedInvokeSucceededDetails).toEqual({
          Result: {
            Payload: '{"success": true, "data": "test-result"}',
          },
          Error: undefined,
        });
      });

      it("should update CHAINED_INVOKE operation with FAILED status", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-fail-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke-fail",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.FAILED,
          EndTimestamp: new Date(),
          ChainedInvokeDetails: {
            Error: {
              ErrorType: "InvokeError",
              ErrorMessage: "Function failed",
            },
          },
        };

        const result = storage.updateOperation(
          "invoke-fail-op",
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe("invoke-fail-op");
        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );
        expect(result.operation.ChainedInvokeDetails?.Error).toEqual({
          ErrorType: "InvokeError",
          ErrorMessage: "Function failed",
        });

        // Should have added ChainedInvokeFailed event
        expect(result.events).toHaveLength(2); // Start event + Failed event
        const failedEvent = result.events[1];
        expect(failedEvent.EventType).toBe("ChainedInvokeFailed");
        expect(failedEvent.ChainedInvokeFailedDetails).toEqual({
          Result: undefined,
          Error: {
            Payload: {
              ErrorType: "InvokeError",
              ErrorMessage: "Function failed",
            },
          },
        });
      });

      it("should update CHAINED_INVOKE operation with STOPPED status", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-cancel-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke-cancel",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.STOPPED,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          "invoke-cancel-op",
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe("invoke-cancel-op");
        expect(result.operation.Status).toBe(OperationStatus.STOPPED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );

        // Should have added InvokeStopped event
        expect(result.events).toHaveLength(2); // Start event + Stopped event
        const stoppedEvent = result.events[1];
        expect(stoppedEvent.EventType).toBe("ChainedInvokeStopped");
        expect(stoppedEvent.ChainedInvokeStoppedDetails).toEqual({
          Result: undefined,
          Error: undefined,
        });
      });

      it("should update CHAINED_INVOKE operation with TIMED_OUT status", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-timeout-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke-timeout",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.TIMED_OUT,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          "invoke-timeout-op",
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe("invoke-timeout-op");
        expect(result.operation.Status).toBe(OperationStatus.TIMED_OUT);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );

        // Should have added InvokeTimedOut event
        expect(result.events).toHaveLength(2); // Start event + TimedOut event
        const timedOutEvent = result.events[1];
        expect(timedOutEvent.EventType).toBe("ChainedInvokeTimedOut");
        expect(timedOutEvent.ChainedInvokeTimedOutDetails).toEqual({
          Result: undefined,
          Error: undefined,
        });
      });

      it("should update CHAINED_INVOKE operation without ChainedInvokeDetails", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-no-details-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke-no-details",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.SUCCEEDED,
          EndTimestamp: new Date(),
          // No ChainedInvokeDetails provided
        };

        const result = storage.updateOperation(
          "invoke-no-details-op",
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe("invoke-no-details-op");
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);

        // Should have added InvokeSucceeded event with undefined Result and Error
        expect(result.events).toHaveLength(2); // Start event + Success event
        const successEvent = result.events[1];
        expect(successEvent.EventType).toBe("ChainedInvokeSucceeded");
        expect(successEvent.ChainedInvokeSucceededDetails).toEqual({
          Result: undefined,
          Error: undefined,
        });
      });

      it("should handle CHAINED_INVOKE operation with empty Result and Error strings", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-empty-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke-empty",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.SUCCEEDED,
          EndTimestamp: new Date(),
          ChainedInvokeDetails: {
            Result: "", // Empty string
            Error: {
              ErrorType: "",
              ErrorMessage: "",
            },
          },
        };

        const result = storage.updateOperation(
          "invoke-empty-op",
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe("invoke-empty-op");
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
        expect(result.operation.ChainedInvokeDetails?.Result).toBe("");
        expect(result.operation.ChainedInvokeDetails?.Error).toEqual({
          ErrorMessage: "",
          ErrorType: "",
        });

        // Should have added InvokeSucceeded event with empty string payloads
        expect(result.events).toHaveLength(2); // Start event + Success event
        const successEvent = result.events[1];
        expect(successEvent.EventType).toBe("ChainedInvokeSucceeded");
        expect(successEvent.ChainedInvokeSucceededDetails).toEqual({
          Result: {
            Payload: "",
          },
          Error: {
            Payload: {
              ErrorMessage: "",
              ErrorType: "",
            },
          },
        });
      });
    });

    describe("invalid operation updates", () => {
      it("should not update CHAINED_INVOKE operation with both Result and Error", () => {
        storage.initialize();

        // Register an CHAINED_INVOKE operation first
        const invokeUpdate: OperationUpdate = {
          Id: "invoke-both-op",
          Type: OperationType.CHAINED_INVOKE,
          Action: OperationAction.START,
          Name: "test-invoke-both",
        };
        storage.registerUpdate(invokeUpdate);

        const newOperationData = {
          Type: OperationType.CHAINED_INVOKE,
          Status: OperationStatus.FAILED,
          EndTimestamp: new Date(),
          ChainedInvokeDetails: {
            Result: '{"partial": "data"}',
            Error: {
              ErrorType: "PartialError",
              ErrorMessage: "Partial failure",
            },
          },
        };

        expect(() =>
          storage.updateOperation(
            "invoke-both-op",
            newOperationData,
            undefined,
            undefined,
          ),
        ).toThrow(
          "Could not update operation with both Result and Error in details.",
        );
      });

      it.each([
        OperationStatus.PENDING,
        OperationStatus.READY,
        OperationStatus.CANCELLED,
        OperationStatus.STARTED,
      ])(
        `should throw error for invalid CHAINED_INVOKE status %s`,
        (status) => {
          storage.initialize();

          // Register an CHAINED_INVOKE operation first
          const invokeUpdate: OperationUpdate = {
            Id: "invoke-invalid-op",
            Type: OperationType.CHAINED_INVOKE,
            Action: OperationAction.START,
            Name: "test-invoke-invalid",
          };
          storage.registerUpdate(invokeUpdate);

          const newOperationData = {
            Type: OperationType.CHAINED_INVOKE,
            Status: status,
            EndTimestamp: new Date(),
          };

          expect(() => {
            storage.updateOperation(
              "invoke-invalid-op",
              newOperationData,
              undefined,
              undefined,
            );
          }).toThrow(`Invalid status update for CHAINED_INVOKE: ${status}`);
        },
      );
    });
  });

  describe("EXECUTION operation updates", () => {
    describe("valid operation updates", () => {
      it("should update EXECUTION operation with SUCCEEDED status and create history event", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.SUCCEEDED,
          EndTimestamp: new Date(),
          ExecutionDetails: {
            InputPayload: '{"success": true, "data": "test-result"}',
          },
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          '{"success": true, "data": "test-result"}',
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );
        expect(result.operation.ExecutionDetails?.InputPayload).toBe(
          '{"success": true, "data": "test-result"}',
        );

        // Should have added ExecutionSucceeded event
        expect(result.events).toHaveLength(2); // Start event + Success event
        const successEvent = result.events[1];
        expect(successEvent.EventType).toBe("ExecutionSucceeded");
        expect(successEvent.ExecutionSucceededDetails).toEqual({
          Result: {
            Payload: '{"success": true, "data": "test-result"}',
          },
          Error: undefined,
        });
      });

      it("should update EXECUTION operation with FAILED status", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.FAILED,
          EndTimestamp: new Date(),
          ExecutionDetails: {
            InputPayload: "{}",
          },
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          undefined,
          {
            ErrorType: "ExecutionError",
            ErrorMessage: "Execution failed",
          },
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.FAILED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );

        // Should have added ExecutionFailed event
        expect(result.events).toHaveLength(2); // Start event + Failed event
        const failedEvent = result.events[1];
        expect(failedEvent.EventType).toBe("ExecutionFailed");
        expect(failedEvent.ExecutionFailedDetails).toEqual({
          Result: undefined,
          Error: {
            Payload: {
              ErrorType: "ExecutionError",
              ErrorMessage: "Execution failed",
            },
          },
        });
      });

      it("should update EXECUTION operation with STOPPED status", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.STOPPED,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.STOPPED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );

        // Should have added ExecutionStopped event
        expect(result.events).toHaveLength(2); // Start event + Stopped event
        const stoppedEvent = result.events[1];
        expect(stoppedEvent.EventType).toBe("ExecutionStopped");
        expect(stoppedEvent.ExecutionStoppedDetails).toEqual({
          Result: undefined,
          Error: undefined,
        });
      });

      it("should update EXECUTION operation with TIMED_OUT status", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.TIMED_OUT,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.TIMED_OUT);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );

        // Should have added ExecutionTimedOut event
        expect(result.events).toHaveLength(2); // Start event + TimedOut event
        const timedOutEvent = result.events[1];
        expect(timedOutEvent.EventType).toBe("ExecutionTimedOut");
        expect(timedOutEvent.ExecutionTimedOutDetails).toEqual({
          Result: undefined,
          Error: undefined,
        });
      });

      it("should update EXECUTION operation with STARTED status", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.STARTED,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          undefined,
          undefined,
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.STARTED);
        expect(result.operation.EndTimestamp).toEqual(
          newOperationData.EndTimestamp,
        );

        // Should have added ExecutionStarted event
        expect(result.events).toHaveLength(2); // Start event + Started event
        const startedEvent = result.events[1];
        expect(startedEvent.EventType).toBe("ExecutionStarted");
        expect(startedEvent.ExecutionStartedDetails).toEqual({
          Result: undefined,
          Error: undefined,
        });
      });

      it("should update EXECUTION operation with both result and error", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.FAILED,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          '{"partial": "data"}',
          {
            ErrorType: "PartialError",
            ErrorMessage: "Partial failure",
          },
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.FAILED);

        // Should have added ExecutionFailed event with both Result and Error
        expect(result.events).toHaveLength(2); // Start event + Failed event
        const failedEvent = result.events[1];
        expect(failedEvent.EventType).toBe("ExecutionFailed");
        expect(failedEvent.ExecutionFailedDetails).toEqual({
          Result: {
            Payload: '{"partial": "data"}',
          },
          Error: {
            Payload: {
              ErrorType: "PartialError",
              ErrorMessage: "Partial failure",
            },
          },
        });
      });

      it("should handle EXECUTION operation with empty Result and Error strings", () => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: OperationStatus.SUCCEEDED,
          EndTimestamp: new Date(),
        };

        const result = storage.updateOperation(
          initialOperation.operation.Id,
          newOperationData,
          "", // Empty string
          {
            ErrorType: "",
            ErrorMessage: "",
          },
        );

        // Should return the updated CheckpointOperation
        expect(result.operation.Id).toBe(initialOperation.operation.Id);
        expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);

        // Should have added ExecutionSucceeded event with empty string payloads
        expect(result.events).toHaveLength(2); // Start event + Success event
        const successEvent = result.events[1];
        expect(successEvent.EventType).toBe("ExecutionSucceeded");
        expect(successEvent.ExecutionSucceededDetails).toEqual({
          Result: {
            Payload: "",
          },
          Error: {
            Payload: {
              ErrorMessage: "",
              ErrorType: "",
            },
          },
        });
      });
    });

    describe("invalid operation updates", () => {
      it.each([
        OperationStatus.PENDING,
        OperationStatus.READY,
        OperationStatus.CANCELLED,
      ])(`should throw error for invalid EXECUTION status %s`, (status) => {
        const initialOperation = storage.initialize();

        const newOperationData = {
          Type: OperationType.EXECUTION,
          Status: status,
          EndTimestamp: new Date(),
        };

        expect(() => {
          storage.updateOperation(
            initialOperation.operation.Id,
            newOperationData,
            undefined,
            undefined,
          );
        }).toThrow(`Invalid status update for EXECUTION: ${status}`);
      });
    });
  });

  it("should update existing operation and return the updated CheckpointOperation", () => {
    const initialOperation = storage.initialize();

    const newOperationData = {
      Status: OperationStatus.SUCCEEDED,
      EndTimestamp: new Date(),
    };

    const result = storage.updateOperation(
      initialOperation.operation.Id,
      newOperationData,
      undefined,
      undefined,
    );

    // Should return the updated CheckpointOperation
    expect(result.operation.Id).toBe(initialOperation.operation.Id);
    expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED); // Updated status
    expect(result.operation.EndTimestamp).toEqual(
      newOperationData.EndTimestamp,
    );

    // And the stored operation should be the same as returned
    const storedOperation = storage.operationDataMap.get(
      initialOperation.operation.Id,
    );
    expect(storedOperation).toBe(result);
    expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(storedOperation?.operation.EndTimestamp).toEqual(
      newOperationData.EndTimestamp,
    );
  });

  it("should preserve existing operation properties when updating", () => {
    const initialOperation = storage.initialize();
    const originalType = initialOperation.operation.Type;
    const originalExecutionDetails =
      initialOperation.operation.ExecutionDetails;

    const newOperationData = {
      Status: OperationStatus.FAILED,
      SomeNewField: "new-value",
    };

    storage.updateOperation(
      initialOperation.operation.Id,
      newOperationData,
      undefined,
      undefined,
    );

    const storedOperation = storage.operationDataMap.get(
      initialOperation.operation.Id,
    );
    expect(storedOperation?.operation.Type).toBe(originalType);
    expect(storedOperation?.operation.ExecutionDetails).toBe(
      originalExecutionDetails,
    );
    expect(storedOperation?.operation.Status).toBe(OperationStatus.FAILED);
    expect(
      (storedOperation?.operation as unknown as Record<string, unknown>)
        .SomeNewField,
    ).toBe("new-value");
  });

  it("should handle partial operation updates", () => {
    storage.initialize();

    // Register a step operation first
    const stepUpdate: OperationUpdate = {
      Id: "step-to-update",
      Type: OperationType.STEP,
      Action: OperationAction.START,
      Name: "test-step",
    };
    storage.registerUpdate(stepUpdate);

    const partialUpdate = {
      Status: OperationStatus.SUCCEEDED,
    };

    const result = storage.updateOperation(
      "step-to-update",
      partialUpdate,
      undefined,
      undefined,
    );

    expect(result.operation.Id).toBe("step-to-update");
    expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED); // Updated

    // Check stored operation is the same as returned
    const storedOperation = storage.operationDataMap.get("step-to-update");
    expect(storedOperation).toBe(result);
    expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(storedOperation?.operation.Name).toBe("test-step"); // Preserved
    expect(storedOperation?.operation.Type).toBe(OperationType.STEP); // Preserved
  });

  it("should throw error for non-existent operation", () => {
    storage.initialize();

    expect(() => {
      storage.updateOperation(
        "non-existent-id",
        {
          Status: OperationStatus.SUCCEEDED,
        },
        undefined,
        undefined,
      );
    }).toThrow("Could not find operation");
  });

  it("should handle complex operation updates", () => {
    storage.initialize();

    // Register a complex operation
    const complexUpdate: OperationUpdate = {
      Id: "complex-op",
      Action: OperationAction.START,
      Type: OperationType.STEP,
      Name: "complex-step",
      Payload: "initial-payload",
    };
    storage.registerUpdate(complexUpdate);

    const updateData = {
      Status: OperationStatus.SUCCEEDED,
      EndTimestamp: new Date(),
      StepDetails: {
        Result: "final-result",
        Attempt: 1,
      },
    };

    const result = storage.updateOperation(
      "complex-op",
      updateData,
      undefined,
      undefined,
    );

    // Updated operation returned
    expect(result.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(result.operation.StepDetails).toEqual({
      Result: "final-result",
      Attempt: 1,
    });
    expect(result.operation.EndTimestamp).toEqual(updateData.EndTimestamp);

    // Stored operation should be the same as returned
    const storedOperation = storage.operationDataMap.get("complex-op");
    expect(storedOperation).toBe(result);
    expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(storedOperation?.operation.StepDetails).toEqual({
      Result: "final-result",
      Attempt: 1,
    });
    expect(storedOperation?.operation.EndTimestamp).toEqual(
      updateData.EndTimestamp,
    );
  });

  it("should handle updates with undefined or null values", () => {
    const initialOperation = storage.initialize();

    const updateWithUndefined = {
      Status: OperationStatus.SUCCEEDED,
      SomeField: undefined,
      AnotherField: null,
    };

    storage.updateOperation(
      initialOperation.operation.Id,
      updateWithUndefined,
      undefined,
      undefined,
    );

    const storedOperation = storage.operationDataMap.get(
      initialOperation.operation.Id,
    );
    expect(storedOperation?.operation.Status).toBe(OperationStatus.SUCCEEDED);
    expect(
      (storedOperation?.operation as unknown as Record<string, unknown>)
        .SomeField,
    ).toBeUndefined();
    expect(
      (storedOperation?.operation as unknown as Record<string, unknown>)
        .AnotherField,
    ).toBeNull();
  });

  describe("retry operations", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should process retry operation during initial registration", () => {
      // Initialize storage
      storage.initialize();

      // Register a STEP operation with RETRY action
      const result = storage.registerUpdate({
        Id: "retry-step-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-step",
        StepOptions: {
          NextAttemptDelaySeconds: 15,
        },
      });

      expect(result.operation.Id).toBe("retry-step-id");
      expect(result.operation.Status).toBe(OperationStatus.PENDING);
      expect(result.operation.Type).toBe(OperationType.STEP);
      expect(result.operation.Name).toBe("test-retry-step");
      expect(result.operation.StepDetails?.Attempt).toBe(1);
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toBeInstanceOf(
        Date,
      );

      // Check that NextAttemptTimestamp is set correctly (current time + 15 seconds)
      const expectedTimestamp = new Date("2023-01-01T00:00:15.000Z");
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        expectedTimestamp,
      );
    });

    it("should process retry operation without delay during registration", () => {
      // Initialize storage
      storage.initialize();

      // Register a STEP operation with RETRY action but no delay
      const result = storage.registerUpdate({
        Id: "retry-no-delay-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-no-delay",
      });

      expect(result.operation.Id).toBe("retry-no-delay-id");
      expect(result.operation.Status).toBe(OperationStatus.PENDING);
      expect(result.operation.StepDetails?.Attempt).toBe(1);

      // Check that NextAttemptTimestamp is set to current time (no delay)
      const expectedTimestamp = new Date("2023-01-01T00:00:00.000Z");
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        expectedTimestamp,
      );
    });

    it("should handle retry with zero delay seconds", () => {
      // Initialize storage
      storage.initialize();

      // Register a STEP operation with RETRY action and explicit zero delay
      const result = storage.registerUpdate({
        Id: "retry-zero-delay-id",
        Action: OperationAction.RETRY,
        Type: OperationType.STEP,
        Name: "test-retry-zero-delay",
        StepOptions: {
          NextAttemptDelaySeconds: 0,
        },
      });

      expect(result.operation.Status).toBe(OperationStatus.PENDING);
      expect(result.operation.StepDetails?.Attempt).toBe(1);

      // Check that NextAttemptTimestamp is set to current time (zero delay)
      const expectedTimestamp = new Date("2023-01-01T00:00:00.000Z");
      expect(result.operation.StepDetails?.NextAttemptTimestamp).toEqual(
        expectedTimestamp,
      );
    });
  });
});
