import { OperationType, OperationStatus } from "@aws-sdk/client-lambda";
import { historyEventTypes } from "../history-event-types";

describe("historyEventTypes", () => {
  describe("ExecutionStarted", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ExecutionStarted;

      expect(config).toEqual({
        operationType: OperationType.EXECUTION,
        operationStatus: OperationStatus.STARTED,
        operationDetailPlace: "ExecutionDetails",
        detailPlace: "ExecutionStartedDetails",
        isStartEvent: true,
        isEndEvent: false,
        hasResult: false,
      });
    });
  });

  describe("ExecutionFailed", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ExecutionFailed;

      expect(config).toEqual({
        operationType: OperationType.EXECUTION,
        operationStatus: OperationStatus.FAILED,
        detailPlace: "ExecutionFailedDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: false,
      });
    });
  });

  describe("ExecutionStopped", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ExecutionStopped;

      expect(config).toEqual({
        operationType: OperationType.EXECUTION,
        operationStatus: OperationStatus.STOPPED,
        detailPlace: "ExecutionStoppedDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: false,
      });
    });
  });

  describe("ExecutionSucceeded", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ExecutionSucceeded;

      expect(config).toEqual({
        operationType: OperationType.EXECUTION,
        operationStatus: OperationStatus.SUCCEEDED,
        detailPlace: "ExecutionSucceededDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: false,
      });
    });
  });

  describe("ExecutionTimedOut", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ExecutionTimedOut;

      expect(config).toEqual({
        operationType: OperationType.EXECUTION,
        operationStatus: OperationStatus.TIMED_OUT,
        detailPlace: "ExecutionTimedOutDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: false,
      });
    });
  });

  describe("CallbackStarted", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.CallbackStarted;

      expect(config).toEqual({
        operationType: OperationType.CALLBACK,
        operationStatus: OperationStatus.STARTED,
        operationDetailPlace: "CallbackDetails",
        detailPlace: "CallbackStartedDetails",
        isStartEvent: true,
        isEndEvent: false,
        hasResult: false,
      });
    });
  });

  describe("CallbackFailed", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.CallbackFailed;

      expect(config).toEqual({
        operationType: OperationType.CALLBACK,
        operationStatus: OperationStatus.FAILED,
        operationDetailPlace: "CallbackDetails",
        detailPlace: "CallbackFailedDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("CallbackSucceeded", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.CallbackSucceeded;

      expect(config).toEqual({
        operationType: OperationType.CALLBACK,
        operationStatus: OperationStatus.SUCCEEDED,
        operationDetailPlace: "CallbackDetails",
        detailPlace: "CallbackSucceededDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("CallbackTimedOut", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.CallbackTimedOut;

      expect(config).toEqual({
        operationType: OperationType.CALLBACK,
        operationStatus: OperationStatus.TIMED_OUT,
        operationDetailPlace: "CallbackDetails",
        detailPlace: "CallbackTimedOutDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("ContextStarted", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ContextStarted;

      expect(config).toEqual({
        operationType: OperationType.CONTEXT,
        operationStatus: OperationStatus.STARTED,
        detailPlace: "ContextStartedDetails",
        isStartEvent: true,
        isEndEvent: false,
        operationDetailPlace: undefined,
        hasResult: false,
      });
    });
  });

  describe("ContextFailed", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ContextFailed;

      expect(config).toEqual({
        operationType: OperationType.CONTEXT,
        operationStatus: OperationStatus.FAILED,
        operationDetailPlace: "ContextDetails",
        detailPlace: "ContextFailedDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("ContextSucceeded", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.ContextSucceeded;

      expect(config).toEqual({
        operationType: OperationType.CONTEXT,
        operationStatus: OperationStatus.SUCCEEDED,
        operationDetailPlace: "ContextDetails",
        detailPlace: "ContextSucceededDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("InvokeStarted", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.InvokeStarted;

      expect(config).toEqual({
        operationType: OperationType.INVOKE,
        operationStatus: OperationStatus.STARTED,
        operationDetailPlace: "InvokeDetails",
        detailPlace: "InvokeStartedDetails",
        isStartEvent: true,
        isEndEvent: false,
        hasResult: false,
      });
    });
  });

  describe("InvokeFailed", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.InvokeFailed;

      expect(config).toEqual({
        operationType: OperationType.INVOKE,
        operationStatus: OperationStatus.FAILED,
        detailPlace: "InvokeFailedDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: true,
      });
    });
  });

  describe("InvokeSucceeded", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.InvokeSucceeded;

      expect(config).toEqual({
        operationType: OperationType.INVOKE,
        operationStatus: OperationStatus.SUCCEEDED,
        detailPlace: "InvokeSucceededDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: true,
      });
    });
  });

  describe("InvokeTimedOut", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.InvokeTimedOut;

      expect(config).toEqual({
        operationType: OperationType.INVOKE,
        operationStatus: OperationStatus.TIMED_OUT,
        detailPlace: "InvokeTimedOutDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: true,
      });
    });
  });

  describe("InvokeCancelled", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.InvokeCancelled;

      expect(config).toEqual({
        operationType: OperationType.INVOKE,
        operationStatus: OperationStatus.CANCELLED,
        detailPlace: "InvokeStoppedDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: true,
      });
    });
  });

  describe("StepStarted", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.StepStarted;

      expect(config).toEqual({
        operationType: OperationType.STEP,
        operationStatus: OperationStatus.STARTED,
        operationDetailPlace: "StepDetails",
        detailPlace: "StepStartedDetails",
        isStartEvent: true,
        isEndEvent: false,
        hasResult: false,
      });
    });
  });

  describe("StepFailed", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.StepFailed;

      expect(config).toEqual({
        operationType: OperationType.STEP,
        operationStatus: OperationStatus.FAILED,
        operationDetailPlace: "StepDetails",
        detailPlace: "StepFailedDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("StepSucceeded", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.StepSucceeded;

      expect(config).toEqual({
        operationType: OperationType.STEP,
        operationStatus: OperationStatus.SUCCEEDED,
        operationDetailPlace: "StepDetails",
        detailPlace: "StepSucceededDetails",
        isStartEvent: false,
        isEndEvent: true,
        hasResult: true,
      });
    });
  });

  describe("WaitStarted", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.WaitStarted;

      expect(config).toEqual({
        operationType: OperationType.WAIT,
        operationStatus: OperationStatus.STARTED,
        operationDetailPlace: "WaitDetails",
        detailPlace: "WaitStartedDetails",
        isStartEvent: true,
        isEndEvent: false,
        hasResult: true,
      });
    });
  });

  describe("WaitSucceeded", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.WaitSucceeded;

      expect(config).toEqual({
        operationType: OperationType.WAIT,
        operationStatus: OperationStatus.SUCCEEDED,
        detailPlace: "WaitSucceededDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: true,
      });
    });
  });

  describe("WaitCancelled", () => {
    it("should have correct configuration", () => {
      const config = historyEventTypes.WaitCancelled;

      expect(config).toEqual({
        operationType: OperationType.WAIT,
        operationStatus: OperationStatus.CANCELLED,
        detailPlace: "WaitCancelledDetails",
        isStartEvent: false,
        isEndEvent: true,
        operationDetailPlace: undefined,
        hasResult: true,
      });
    });
  });
});
