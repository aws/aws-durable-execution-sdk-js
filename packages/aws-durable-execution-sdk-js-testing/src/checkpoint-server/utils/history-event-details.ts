import {
  OperationAction,
  OperationUpdate,
  Event,
  OperationType,
  EventType,
  Operation,
} from "@aws-sdk/client-lambda";

/**
 * Metadata required for generating event details.
 */
interface DetailsMetadata {
  /** Optional execution timeout in seconds */
  executionTimeout?: number;
}

/**
 * Represents the structure for history event details with type-safe event detail extraction.
 *
 * @template T - The key of the Event type that corresponds to the specific event detail type
 */
export interface HistoryEventDetails<T extends keyof Event> {
  /** The type of event this detail handler processes */
  eventType: EventType;
  /** The property name in the Event type where these details should be placed */
  detailPlace: T;
  /** Function that generates the event details from operation data */
  getDetails: (
    update: OperationUpdate,
    operation: Operation,
    metadata: DetailsMetadata,
  ) => Event[T];
}

/**
 * Factory function to create a HistoryEventDetails object with proper typing.
 *
 * @template T - The key of the Event type that corresponds to the specific event detail type
 * @param eventType - The type of event this detail handler processes
 * @param detailPlace - The property name in the Event type where these details should be placed
 * @param getDetails - Function that generates the event details from operation data
 * @returns A properly typed HistoryEventDetails object
 */
function createEventDetails<T extends keyof Event>(
  eventType: EventType,
  detailPlace: T,
  getDetails: (
    update: OperationUpdate,
    operation: Operation,
    metadata: DetailsMetadata,
  ) => Event[T],
): HistoryEventDetails<T> {
  return { eventType, detailPlace, getDetails };
}

/**
 * Type alias for retrieving the correct HistoryEventDetails type based on operation action and type.
 *
 * @template Action - The operation action (START, FAIL, SUCCEED, RETRY)
 * @template Type - The operation type (EXECUTION, CALLBACK, CONTEXT, INVOKE, STEP, WAIT)
 */
export type HistoryEventDetail<
  Action extends OperationAction,
  Type extends OperationType,
> = (typeof historyEventDetailMap)[`${Action}-${Type}`];

/**
 * Mapping of operation action-type combinations to their corresponding history event details.
 *
 * This map provides handlers for all supported combinations of OperationAction and OperationType,
 * defining how to transform operation updates into properly formatted history events.
 *
 * Supported operation combinations:
 * - Execution: START, FAIL, SUCCEED
 * - Callback: START
 * - Context: START, FAIL, SUCCEED
 * - Invoke: START
 * - Step: START, RETRY, FAIL, SUCCEED
 * - Wait: START
 */
const historyEventDetailMap = {
  // Execution events
  [`${OperationAction.START}-${OperationType.EXECUTION}`]: createEventDetails(
    EventType.ExecutionStarted,
    "ExecutionStartedDetails",
    (update, _, metadata) => ({
      Input: {
        Payload: update.Payload,
      },
      ExecutionTimeout: metadata.executionTimeout,
    }),
  ),
  [`${OperationAction.FAIL}-${OperationType.EXECUTION}`]: createEventDetails(
    EventType.ExecutionFailed,
    "ExecutionFailedDetails",
    (update) => ({
      Error: {
        Payload: update.Error,
      },
    }),
  ),
  [`${OperationAction.SUCCEED}-${OperationType.EXECUTION}`]: createEventDetails(
    EventType.ExecutionSucceeded,
    "ExecutionSucceededDetails",
    (update) => ({
      Result: {
        Payload: update.Payload,
      },
    }),
  ),

  // Callback events
  [`${OperationAction.START}-${OperationType.CALLBACK}`]: createEventDetails(
    EventType.CallbackStarted,
    "CallbackStartedDetails",
    (update, operation) => ({
      CallbackId: operation.CallbackDetails?.CallbackId,
      Timeout: update.CallbackOptions?.TimeoutSeconds,
      HeartbeatTimeout: update.CallbackOptions?.HeartbeatTimeoutSeconds,
      Input: {
        Payload: update.Payload,
      },
    }),
  ),

  // Context events
  [`${OperationAction.START}-${OperationType.CONTEXT}`]: createEventDetails(
    EventType.ContextStarted,
    "ContextStartedDetails",
    () => ({}),
  ),
  [`${OperationAction.FAIL}-${OperationType.CONTEXT}`]: createEventDetails(
    EventType.ContextFailed,
    "ContextFailedDetails",
    (update) => ({
      Error: {
        Payload: update.Error,
      },
    }),
  ),
  [`${OperationAction.SUCCEED}-${OperationType.CONTEXT}`]: createEventDetails(
    EventType.ContextSucceeded,
    "ContextSucceededDetails",
    (update) => ({
      Result: {
        Payload: update.Payload,
      },
    }),
  ),

  // Invoke events
  [`${OperationAction.START}-${OperationType.CHAINED_INVOKE}`]:
    createEventDetails(
      EventType.ChainedInvokeStarted,
      "ChainedInvokeStartedDetails",
      () => ({
        DurableExecutionArn: "", // TODO: add the execution ARN
      }),
    ),

  // Step events
  [`${OperationAction.START}-${OperationType.STEP}`]: createEventDetails(
    EventType.StepStarted,
    "StepStartedDetails",
    () => ({}),
  ),
  [`${OperationAction.RETRY}-${OperationType.STEP}`]: createEventDetails(
    EventType.StepStarted,
    "StepStartedDetails",
    () => ({}),
  ),
  [`${OperationAction.FAIL}-${OperationType.STEP}`]: createEventDetails(
    EventType.StepFailed,
    "StepFailedDetails",
    (update, operation) => ({
      Error: {
        Payload: update.Error,
      },
      RetryDetails: {
        NextAttemptDelaySeconds: update.StepOptions?.NextAttemptDelaySeconds,
        CurrentAttempt: operation.StepDetails?.Attempt,
      },
    }),
  ),
  [`${OperationAction.SUCCEED}-${OperationType.STEP}`]: createEventDetails(
    EventType.StepSucceeded,
    "StepSucceededDetails",
    (update, operation) => ({
      Result: {
        Payload: update.Payload,
      },
      RetryDetails: {
        NextAttemptDelaySeconds: update.StepOptions?.NextAttemptDelaySeconds,
        CurrentAttempt: operation.StepDetails?.Attempt,
      },
    }),
  ),

  // Wait events
  [`${OperationAction.START}-${OperationType.WAIT}`]: createEventDetails(
    EventType.WaitStarted,
    "WaitStartedDetails",
    (update) => {
      const scheduledEndTimestamp = new Date();
      scheduledEndTimestamp.setSeconds(
        scheduledEndTimestamp.getSeconds() +
          (update.WaitOptions?.WaitSeconds ?? 0),
      );
      return {
        Duration: update.WaitOptions?.WaitSeconds,
        ScheduledEndTimestamp: scheduledEndTimestamp,
      };
    },
  ),
} satisfies Record<string, HistoryEventDetails<keyof Event>>;

/**
 * Retrieves the appropriate history event detail handler for a given operation action and type.
 *
 * @template Action - The operation action (START, FAIL, SUCCEED, RETRY)
 * @template Type - The operation type (EXECUTION, CALLBACK, CONTEXT, INVOKE, STEP, WAIT)
 * @param action - The action being performed on the operation
 * @param type - The type of operation being performed
 * @returns The corresponding HistoryEventDetails handler, or undefined if no handler exists for the combination
 *
 * @example
 * ```typescript
 * const handler = getHistoryEventDetail(OperationAction.START, OperationType.EXECUTION);
 * if (handler) {
 *   const eventDetails = handler.getDetails(update, operation, metadata);
 * }
 * ```
 */
export function getHistoryEventDetail<
  Action extends OperationAction,
  Type extends OperationType,
>(action: Action, type: Type): HistoryEventDetail<Action, Type> | undefined {
  return historyEventDetailMap[`${action}-${type}`];
}
