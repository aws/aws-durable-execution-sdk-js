import {
  CallbackTimeoutError,
  DurableOperationError,
} from "@aws/durable-execution-sdk-js";
import { ComputeError } from "../errors";

/**
 * The base class of every error that {@link agentcore} reports for a failed
 * job.
 *
 * @remarks
 * Catch it to handle every AgentCore failure the same way. Catch a subclass
 * to handle one kind:
 *
 * - {@link AgentcoreDeliveryError}: InvokeAgentRuntime failed after all
 *   retries, or the agent did not accept the job.
 * - {@link AgentcoreJobFailedError}: the agent reported a failure.
 * - {@link AgentcoreTimeoutError}: no result or no heartbeat arrived in time.
 *
 * It extends {@link ComputeError}. So code that catches `ComputeError`
 * handles an AgentCore failure and a failure of any other compute type
 * alike.
 *
 * The SDK checkpoints a failed operation's error type, message, and data,
 * and rebuilds the error from them. The operation's error mapper restores
 * the AgentCore class from the checkpointed type. So the class is the same
 * on the first run and on replay.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AgentcoreError extends ComputeError {
  readonly errorType: string = "AgentcoreError";
}

/**
 * The job could not be delivered: InvokeAgentRuntime failed after all
 * retries, or the agent answered without `{"accepted": true}`.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AgentcoreDeliveryError extends AgentcoreError {
  readonly errorType: string = "AgentcoreDeliveryError";
}

/**
 * The job in the agent failed. The agent reported the failure with
 * `SendDurableExecutionCallbackFailure`.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AgentcoreJobFailedError extends AgentcoreError {
  readonly errorType: string = "AgentcoreJobFailedError";
}

/**
 * No result arrived within the job's `timeout`, or no heartbeat arrived
 * within its `heartbeatTimeout`. An agent whose session ended during the
 * job ends this way. The message keeps the service's reason.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AgentcoreTimeoutError extends AgentcoreError {
  readonly errorType: string = "AgentcoreTimeoutError";
}

type AgentcoreErrorClass = new (
  message: string,
  cause?: Error,
  errorData?: string,
) => AgentcoreError;

const CLASSES: Readonly<Record<string, AgentcoreErrorClass>> = {
  AgentcoreError,
  AgentcoreDeliveryError,
  AgentcoreJobFailedError,
  AgentcoreTimeoutError,
};

/** The stage of an AgentCore operation that failed. */
export type AgentcoreStage = "delivery" | "job";

/**
 * Converts an error of one stage into its AgentCore error. It runs inside
 * the child context, before the SDK checkpoints the failure. So the
 * checkpoint records the AgentCore error type, and
 * {@link agentcoreErrorMapper} can restore the class from it.
 *
 * Each stage awaits an SDK operation: the request step or the callback. The
 * SDK rejects each with a `DurableOperationError`.
 */
export function toAgentcoreError(
  name: string,
  stage: AgentcoreStage,
  error: DurableOperationError,
): AgentcoreError {
  const detail = error.message;
  const { errorData } = error;
  if (stage === "delivery") {
    return new AgentcoreDeliveryError(
      `AgentCore "${name}": the job could not be delivered: ${detail}`,
      error,
      errorData,
    );
  }
  if (error instanceof CallbackTimeoutError) {
    return new AgentcoreTimeoutError(
      `AgentCore "${name}": the job timed out: ${detail}`,
      error,
      errorData,
    );
  }
  // For a failed callback, the SDK sets cause.name to the ErrorType that the
  // agent reported. The checkpoint keeps only the message. So the message
  // carries the type.
  const jobType =
    error.cause instanceof Error && error.cause.name !== "Error"
      ? ` (${error.cause.name})`
      : "";
  return new AgentcoreJobFailedError(
    `AgentCore "${name}": the job failed${jobType}: ${detail}`,
    error,
    errorData,
  );
}

/** Runs one stage and converts its failure with {@link toAgentcoreError}. */
export async function inStage<T>(
  name: string,
  stage: AgentcoreStage,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAgentcoreError(name, stage, error as DurableOperationError);
  }
}

/**
 * The error mapper of {@link agentcore}.
 *
 * The SDK passes the mapper the error that it rebuilt from the checkpoint,
 * on the first run and on replay alike. The SDK does not know the AgentCore
 * types. So it rebuilds each as a `StepError`, and sets `cause.name` to the
 * checkpointed type. So the mapper restores the class from `cause.name`.
 * Every stage converts its failure with {@link toAgentcoreError}. So any
 * other type means a failure outside the stages. It becomes a plain
 * {@link AgentcoreError}.
 */
export function agentcoreErrorMapper(
  name: string,
): (error: DurableOperationError) => DurableOperationError {
  return (error) => {
    const Class = CLASSES[error.cause?.name ?? ""];
    return Class
      ? new Class(error.message, error.cause, error.errorData)
      : new AgentcoreError(
          `AgentCore "${name}": ${error.message}`,
          error.cause,
          error.errorData,
        );
  };
}
