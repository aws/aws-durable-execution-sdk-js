import { Serdes } from "../utils/serdes/serdes";
import { RetryDecision } from "./step";
import { WaitForCallbackContext } from "./logger";

/**
 * Configuration options for createCallback operations
 */
export interface CreateCallbackConfig<T> {
  /** Maximum time to wait for callback submission in seconds */
  timeout?: number;
  /** Heartbeat timeout in seconds to detect stalled callback operations */
  heartbeatTimeout?: number;
  /** Serialization/deserialization configuration for callback data */
  serdes?: Serdes<T>;
}

/**
 * Configuration options for waitForCallback operations
 */
export interface WaitForCallbackConfig<T> {
  /** Maximum time to wait for callback in seconds */
  timeout?: number;
  /** Heartbeat timeout in seconds to detect stalled operations */
  heartbeatTimeout?: number;
  /** Strategy for retrying failed callback submissions */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  /** Serialization/deserialization configuration for callback data */
  serdes?: Serdes<T>;
}

export type CreateCallbackResult<T> = [Promise<T>, string];

/**
 * Function that submits a callback ID to an external system
 * @param callbackId - Unique identifier for the callback that should be submitted to external system
 * @param context - Context for logging and other operations during callback submission
 * @returns Promise that resolves when the callback ID has been successfully submitted
 */
export type WaitForCallbackSubmitterFunc = (
  callbackId: string,
  context: WaitForCallbackContext,
) => Promise<void>;
