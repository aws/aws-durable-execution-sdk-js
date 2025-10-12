import { TerminationReason } from "../../termination-manager/types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { UnrecoverableInvocationError } from "../unrecoverable-error/unrecoverable-error";
import { log } from "../../utils/logger/logger";
import { SerdesContext } from "../../utils/serdes/serdes";

/**
 * Error thrown when serialization fails
 * This is an unrecoverable invocation error that will terminate the current Lambda invocation
 * because data corruption or incompatible formats indicate a fundamental problem
 */
export class SerializationFailedError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(stepId: string, stepName?: string, originalError?: Error) {
    const message = `Serialization failed for step ${stepName ? `"${stepName}" ` : ""}(${stepId}): ${originalError?.message || "Unknown serialization error"}`;
    super(message, originalError);
  }
}

/**
 * Error thrown when deserialization fails
 * This is an unrecoverable invocation error that will terminate the current Lambda invocation
 * because data corruption or incompatible formats indicate a fundamental problem
 */
export class DeserializationFailedError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(stepId: string, stepName?: string, originalError?: Error) {
    const message = `Deserialization failed for step ${stepName ? `"${stepName}" ` : ""}(${stepId}): ${originalError?.message || "Unknown deserialization error"}`;
    super(message, originalError);
  }
}

/**
 * Type guard to check if an error is a Serdes error
 * @deprecated Use isUnrecoverableInvocationError instead for broader error detection
 */
export function isSerdesError(
  error: unknown,
): error is SerializationFailedError | DeserializationFailedError {
  return (
    error instanceof SerializationFailedError ||
    error instanceof DeserializationFailedError
  );
}

/**
 * Utility function to safely execute serialization with proper error handling
 * Instead of throwing unrecoverable errors, this directly terminates execution
 */
export async function safeSerialize<T>(
  serdes: {
    serialize: (
      value: T | undefined,
      context: SerdesContext,
    ) => Promise<string | undefined>;
  },
  value: T | undefined,
  stepId: string,
  stepName: string | undefined,
  terminationManager: TerminationManager,
  durableExecutionArn: string,
): Promise<string | undefined> {
  try {
    const context: SerdesContext = {
      entityId: stepId,
      durableExecutionArn,
    };
    return await serdes.serialize(value, context);
  } catch (error) {
    const message = `Serialization failed for step ${stepName ? `"${stepName}" ` : ""}(${stepId}): ${error instanceof Error ? error.message : "Unknown serialization error"}`;

    log("💥", "Serialization failed - terminating execution:", {
      stepId,
      stepName,
      error: error instanceof Error ? error.message : String(error),
    });

    terminationManager.terminate({
      reason: TerminationReason.CUSTOM,
      message: message,
    });

    // Return a never-resolving promise to ensure the execution doesn't continue
    return new Promise<string | undefined>(() => {});
  }
}

/**
 * Utility function to safely execute deserialization with proper error handling
 * Instead of throwing unrecoverable errors, this directly terminates execution
 */
export async function safeDeserialize<T>(
  serdes: {
    deserialize: (
      data: string | undefined,
      context: SerdesContext,
    ) => Promise<T | undefined>;
  },
  data: string | undefined,
  stepId: string,
  stepName: string | undefined,
  terminationManager: TerminationManager,
  durableExecutionArn: string,
): Promise<T | undefined> {
  try {
    const context: SerdesContext = {
      entityId: stepId,
      durableExecutionArn,
    };
    return await serdes.deserialize(data, context);
  } catch (error) {
    const message = `Deserialization failed for step ${stepName ? `"${stepName}" ` : ""}(${stepId}): ${error instanceof Error ? error.message : "Unknown deserialization error"}`;

    log("💥", "Deserialization failed - terminating execution:", {
      stepId,
      stepName,
      error: error instanceof Error ? error.message : String(error),
    });

    terminationManager.terminate({
      reason: TerminationReason.CUSTOM,
      message: message,
    });

    // Return a never-resolving promise to ensure the execution doesn't continue
    return new Promise<T | undefined>(() => {});
  }
}
