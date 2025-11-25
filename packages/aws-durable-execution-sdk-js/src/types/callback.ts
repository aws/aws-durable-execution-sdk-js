import { Serdes } from "../utils/serdes/serdes";
import { RetryDecision } from "./step";
import { WaitForCallbackContext } from "./logger";
import { Duration } from "./core";
import { DurablePromise } from "./durable-promise";
import { DurableLogger } from "./durable-logger";

/**
 * Configuration options for createCallback operations
 */
export interface CreateCallbackConfig<T = string> {
  /** Maximum time to wait for callback submission */
  timeout?: Duration;
  /** Heartbeat timeout to detect stalled callback operations */
  heartbeatTimeout?: Duration;
  /** Deserialization configuration for callback data */
  serdes?: Omit<Serdes<T>, "serialize">;
}

/**
 * Configuration options for waitForCallback operations
 */
export interface WaitForCallbackConfig<T = string> {
  /** Maximum time to wait for callback */
  timeout?: Duration;
  /** Heartbeat timeout to detect stalled operations */
  heartbeatTimeout?: Duration;
  /** Strategy for retrying failed callback submissions */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  /** Deserialization configuration for callback data */
  serdes?: Omit<Serdes<T>, "serialize">;
}

export type CreateCallbackResult<T = string> = [DurablePromise<T>, string];

/**
 * Function that submits a callback ID to an external system
 * @param callbackId - Unique identifier for the callback that should be submitted to external system
 * @param context - Context for logging and other operations during callback submission
 * @returns Promise that resolves when the callback ID has been successfully submitted
 */
export type WaitForCallbackSubmitterFunc<Logger extends DurableLogger> = (
  callbackId: string,
  context: WaitForCallbackContext<Logger>,
) => Promise<void>;
