import {
  OperationType,
  OperationStatus,
  EventType,
  Event,
  Operation,
} from "@aws-sdk/client-lambda";

/**
 * Mapping of event types to their corresponding history event type configurations.
 * This constant defines how each event type should be processed
 * and what properties it contains.
 */
export const historyEventTypes = {
  ExecutionStarted: {
    operationType: OperationType.EXECUTION,
    operationStatus: OperationStatus.STARTED,
    operationDetailPlace: "ExecutionDetails",
    detailPlace: "ExecutionStartedDetails",
    isStartEvent: true,
    isEndEvent: false,
    hasResult: false,
  },
  ExecutionFailed: {
    operationType: OperationType.EXECUTION,
    operationStatus: OperationStatus.FAILED,
    detailPlace: "ExecutionFailedDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: false,
  },
  ExecutionStopped: {
    operationType: OperationType.EXECUTION,
    operationStatus: OperationStatus.STOPPED,
    detailPlace: "ExecutionStoppedDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: false,
  },
  ExecutionSucceeded: {
    operationType: OperationType.EXECUTION,
    operationStatus: OperationStatus.SUCCEEDED,
    detailPlace: "ExecutionSucceededDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: false,
  },
  ExecutionTimedOut: {
    operationType: OperationType.EXECUTION,
    operationStatus: OperationStatus.TIMED_OUT,
    detailPlace: "ExecutionTimedOutDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: false,
  },
  CallbackStarted: {
    operationType: OperationType.CALLBACK,
    operationStatus: OperationStatus.STARTED,
    operationDetailPlace: "CallbackDetails",
    detailPlace: "CallbackStartedDetails",
    isStartEvent: true,
    isEndEvent: false,
    hasResult: false,
  },
  CallbackFailed: {
    operationType: OperationType.CALLBACK,
    operationStatus: OperationStatus.FAILED,
    operationDetailPlace: "CallbackDetails",
    detailPlace: "CallbackFailedDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  CallbackSucceeded: {
    operationType: OperationType.CALLBACK,
    operationStatus: OperationStatus.SUCCEEDED,
    operationDetailPlace: "CallbackDetails",
    detailPlace: "CallbackSucceededDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  CallbackTimedOut: {
    operationType: OperationType.CALLBACK,
    operationStatus: OperationStatus.TIMED_OUT,
    operationDetailPlace: "CallbackDetails",
    detailPlace: "CallbackTimedOutDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  ContextStarted: {
    operationType: OperationType.CONTEXT,
    operationStatus: OperationStatus.STARTED,
    detailPlace: "ContextStartedDetails",
    isStartEvent: true,
    isEndEvent: false,
    operationDetailPlace: undefined,
    hasResult: false,
  },
  ContextFailed: {
    operationType: OperationType.CONTEXT,
    operationStatus: OperationStatus.FAILED,
    operationDetailPlace: "ContextDetails",
    detailPlace: "ContextFailedDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  ContextSucceeded: {
    operationType: OperationType.CONTEXT,
    operationStatus: OperationStatus.SUCCEEDED,
    operationDetailPlace: "ContextDetails",
    detailPlace: "ContextSucceededDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  InvokeStarted: {
    operationType: OperationType.INVOKE,
    operationStatus: OperationStatus.STARTED,
    operationDetailPlace: "InvokeDetails",
    detailPlace: "InvokeStartedDetails",
    isStartEvent: true,
    isEndEvent: false,
    hasResult: false,
  },
  InvokeFailed: {
    operationType: OperationType.INVOKE,
    operationStatus: OperationStatus.FAILED,
    detailPlace: "InvokeFailedDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: true,
  },
  InvokeSucceeded: {
    operationType: OperationType.INVOKE,
    operationStatus: OperationStatus.SUCCEEDED,
    detailPlace: "InvokeSucceededDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: true,
  },
  InvokeTimedOut: {
    operationType: OperationType.INVOKE,
    operationStatus: OperationStatus.TIMED_OUT,
    detailPlace: "InvokeTimedOutDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: true,
  },
  InvokeCancelled: {
    operationType: OperationType.INVOKE,
    operationStatus: OperationStatus.CANCELLED,
    detailPlace: "InvokeStoppedDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: true,
  },
  StepStarted: {
    operationType: OperationType.STEP,
    operationStatus: OperationStatus.STARTED,
    operationDetailPlace: "StepDetails",
    detailPlace: "StepStartedDetails",
    isStartEvent: true,
    isEndEvent: false,
    hasResult: false,
  },
  StepFailed: {
    operationType: OperationType.STEP,
    operationStatus: OperationStatus.FAILED,
    operationDetailPlace: "StepDetails",
    detailPlace: "StepFailedDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  StepSucceeded: {
    operationType: OperationType.STEP,
    operationStatus: OperationStatus.SUCCEEDED,
    operationDetailPlace: "StepDetails",
    detailPlace: "StepSucceededDetails",
    isStartEvent: false,
    isEndEvent: true,
    hasResult: true,
  },
  WaitStarted: {
    operationType: OperationType.WAIT,
    operationStatus: OperationStatus.STARTED,
    operationDetailPlace: "WaitDetails",
    detailPlace: "WaitStartedDetails",
    isStartEvent: true,
    isEndEvent: false,
    hasResult: true,
  },
  WaitSucceeded: {
    operationType: OperationType.WAIT,
    operationStatus: OperationStatus.SUCCEEDED,
    detailPlace: "WaitSucceededDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: true,
  },
  WaitCancelled: {
    operationType: OperationType.WAIT,
    operationStatus: OperationStatus.CANCELLED,
    detailPlace: "WaitCancelledDetails",
    isStartEvent: false,
    isEndEvent: true,
    operationDetailPlace: undefined,
    hasResult: true,
  },
} as const satisfies Record<EventType, HistoryEventType>;

/**
 * Defines the structure and properties of a history event type.
 * This interface maps event types to their corresponding operation characteristics.
 */
export interface HistoryEventType {
  /** The type of operation this event represents */
  operationType: OperationType;
  /** The status of the operation (started, succeeded, failed, etc.) */
  operationStatus: OperationStatus;
  /** The property name in the Event object where event details are stored */
  detailPlace: keyof Event | null;
  /** The property name in the Operation object where operation details are stored */
  operationDetailPlace: keyof Operation | undefined;
  /** Whether this event type contains result data */
  hasResult: boolean;
  /** Whether this event marks the start of an operation */
  isStartEvent: boolean;
  /** Whether this event marks the end of an operation */
  isEndEvent: boolean;
}
