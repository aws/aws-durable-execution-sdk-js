import { Operation } from "@amzn/dex-internal-sdk";
import { historyEventTypes } from "./history-event-types";

/**
 * Union type representing the valid operation detail field names.
 * These are the specific properties on the Operation object that contain detailed information
 * about different types of operations (execution, context, step, wait, callback, invoke).
 */
export type OperationDetailFields = Extract<
  keyof Operation,
  | "ExecutionDetails"
  | "ContextDetails"
  | "StepDetails"
  | "WaitDetails"
  | "CallbackDetails"
  | "InvokeDetails"
>;

/**
 * Union type representing all possible history event type configurations.
 */
export type HistoryEventTypes =
  (typeof historyEventTypes)[keyof typeof historyEventTypes];

/**
 * Maps operation detail fields to their non-nullable property value types.
 * @template DetailsField - The operation detail field type
 */
export type PropertyValueMap<DetailsField extends OperationDetailFields> = NonNullable<
  Operation[DetailsField]
>;

/**
 * Utility type that converts an object type to an array of key-value pair tuples.
 * @template T - The object type to convert
 */
export type Entries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T][];
