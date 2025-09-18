import {
  OperationUpdate,
  Event,
  OperationAction,
  OperationType,
  Operation,
  EventType,
} from "@aws-sdk/client-lambda";
import {
  getHistoryEventDetail,
  HistoryEventDetail,
} from "../utils/history-event-details";

/**
 * Processes operation updates and transforms them into properly formatted history events.
 *
 * The EventProcessor is responsible for:
 * - Generating unique event IDs for each history event
 * - Converting operation updates into standardized Event objects
 * - Managing execution timeout metadata
 * - Ensuring proper event structure and timestamps
 */
export class EventProcessor {
  /** Auto-incrementing counter for generating unique event IDs */
  private eventId = 1;

  /**
   * Creates a new EventProcessor instance.
   *
   * @param executionTimeout - Optional execution timeout in seconds that will be included in event metadata
   */
  constructor(private readonly executionTimeout?: number) {}

  /**
   * Creates a history event with the specified details and operation context.
   *
   * This method provides a low-level interface for creating events when you have
   * pre-computed event details. This is required when creating history events for things like completed callbacks
   * or completed wait steps. For most use cases, `processUpdate` is used when an update checkpoint exists.
   *
   * @template T - The key of the Event type that corresponds to the specific event detail type
   * @param eventType - The type of event being created
   * @param operation - The operation context providing metadata like ID, name, and parent relationships
   * @param detailPlace - The property name in the Event type where the details should be placed
   * @param details - The event-specific details to include
   * @returns A complete Event object with auto-generated ID and timestamp
   *
   * @example
   * ```typescript
   * const event = processor.createHistoryEvent(
   *   EventType.ExecutionStarted,
   *   operation,
   *   "ExecutionStartedDetails",
   *   { Input: { Payload: "test" }, ExecutionTimeout: 300 }
   * );
   * ```
   */
  createHistoryEvent<T extends keyof Event>(
    eventType: EventType,
    operation: Operation,
    detailPlace: T,
    details: Event[T]
  ): Event {
    return {
      EventType: eventType,
      SubType: operation.SubType,
      EventId: this.eventId++,
      Id: operation.Id,
      Name: operation.Name,
      EventTimestamp: new Date(),
      ParentId: operation.ParentId,
      [detailPlace]: details,
    };
  }

  /**
   * Processes an operation update and generates the corresponding history event.
   *
   * This is the primary method for converting operation updates into history events.
   * It automatically determines the correct event type and details based on the
   * operation's action and type, then generates a properly formatted Event object.
   *
   * @param update - The operation update containing the action, payload, and options
   * @param operation - The operation context providing metadata and current state
   * @returns A complete Event object representing the operation update
   *
   * @throws {Error} When the update lacks required Action or the operation lacks required Type
   * @throws {Error} When no history event handler exists for the Action-Type combination
   *
   * @example
   * ```typescript
   * const event = processor.processUpdate(
   *   { Action: OperationAction.START, Payload: "input data" },
   *   { Type: OperationType.EXECUTION, Id: "exec-1", Name: "MyExecution" }
   * );
   * ```
   */
  processUpdate(update: OperationUpdate, operation: Operation): Event {
    if (!update.Action || !operation.Type) {
      throw new Error(
        `Could not create history event with Action=${update.Action} and Type=${operation.Type}`
      );
    }

    const historyDetails = EventProcessor.getHistoryDetailsFromUpdate(
      update.Action,
      operation.Type
    );

    return {
      EventType: historyDetails.eventType,
      SubType: update.SubType,
      EventId: this.eventId++,
      Id: update.Id,
      Name: update.Name,
      EventTimestamp: new Date(),
      ParentId: update.ParentId,
      [historyDetails.detailPlace]: historyDetails.getDetails(
        update,
        operation,
        {
          executionTimeout: this.executionTimeout,
        }
      ),
    };
  }

  /**
   * Retrieves the appropriate history event detail handler for a given action-type combination.
   *
   * This static method provides a way to validate that a specific operation action and type
   * combination is supported and to retrieve the corresponding event detail handler.
   *
   * @template Action - The operation action (START, FAIL, SUCCEED, RETRY)
   * @template Type - The operation type (EXECUTION, CALLBACK, CONTEXT, INVOKE, STEP, WAIT)
   * @param action - The action being performed on the operation
   * @param type - The type of operation being performed
   * @returns The corresponding HistoryEventDetail handler
   *
   * @throws {Error} When no handler exists for the specified action-type combination
   *
   * @example
   * ```typescript
   * const handler = EventProcessor.getHistoryDetailsFromUpdate(
   *   OperationAction.START,
   *   OperationType.EXECUTION
   * );
   * // handler contains eventType, detailPlace, and getDetails function
   * ```
   */
  static getHistoryDetailsFromUpdate<
    Action extends OperationAction,
    Type extends OperationType,
  >(action: Action, type: Type): HistoryEventDetail<Action, Type> {
    const historyDetails = getHistoryEventDetail(action, type);
    if (!historyDetails) {
      throw new Error(
        `Could not create history event with Action=${action} and Type=${type}`
      );
    }

    return historyDetails;
  }
}
