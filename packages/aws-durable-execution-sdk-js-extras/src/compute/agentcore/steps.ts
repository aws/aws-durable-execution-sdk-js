// The session-ID and stop steps of an AgentCore operation.
import { randomUUID } from "node:crypto";
import type { DurableContext } from "@aws/durable-execution-sdk-js";
import {
  type BedrockAgentCoreClient,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  callBeforeDeadline,
  INVOCATION_RESERVE_MS,
  remainingTime,
  reserveStartsAt,
  tooLittleTimeMessage,
} from "../deadline";
import { AgentcoreOperationSubType } from "./subtypes";
import type { AgentcoreConfig } from "./types";

/** The runtime session that the InvokeAgentRuntime and stop calls target. */
export interface SessionTarget {
  agentRuntimeArn: string;
  runtimeSessionId: string;
  qualifier?: string;
}

/**
 * Creates the runtime session ID, a UUID, in the step `<name>.session`. The
 * SDK checkpoints it. So every replay and every retry uses the same session.
 */
export async function createSessionId(
  child: DurableContext,
  name: string,
): Promise<string> {
  return (await child.step(`${name}.session`, async () => randomUUID(), {
    subType: AgentcoreOperationSubType.SESSION_ID,
  })) as string;
}

/**
 * Stops the runtime session and logs, instead of throwing, a final failure.
 *
 * When stop runs, the callback already holds the job's outcome. So a stop
 * failure must not replace that outcome. The step's failure is checkpointed.
 * So on replay the step fails again at once, this function catches it again,
 * and the outcome stays the same.
 */
export async function stopSession(
  child: DurableContext,
  name: string,
  retryStrategy: NonNullable<AgentcoreConfig["retryStrategy"]>,
  client: () => BedrockAgentCoreClient,
  target: SessionTarget,
): Promise<void> {
  try {
    await child.step(
      `${name}.stop`,
      async () => {
        assertTimeToCall(child, name, "stop", "stop the session");
        try {
          // The call must end before the invocation reserve. A Lambda
          // timeout during it would end the invocation with the job's
          // outcome recorded and the operation not complete.
          await callBeforeDeadline(
            (sendOptions) =>
              client().send(new StopRuntimeSessionCommand(target), sendOptions),
            reserveStartsAt(remainingTime(child)),
            () => pastReserve(name, "StopRuntimeSession"),
          );
        } catch (error) {
          // The service answers ResourceNotFoundException (HTTP 404) for a
          // session that a stop already ended, and for a session ID that
          // never started. Either way, nothing runs. So it counts as success.
          if ((error as Error).name !== "ResourceNotFoundException") {
            throw error;
          }
        }
      },
      { retryStrategy, subType: AgentcoreOperationSubType.STOP },
    );
  } catch (error) {
    // The job's outcome is already recorded, so the operation still returns
    // it. The worker reports HealthyBusy while its handler runs, and the
    // service keeps such a session alive. So a session whose handler still
    // runs ends only at the runtime's maxLifetime. An idle session ends at
    // the idle timeout. A missing permission fails every stop, and this log
    // is the only sign of it. So it is an error, not a warning, and it names
    // the permission only for AccessDeniedException.
    const causeName = (error as { cause?: { name?: unknown } }).cause?.name;
    const hint =
      causeName === "AccessDeniedException"
        ? " The function's execution role needs bedrock-agentcore:StopRuntimeSession on the agent runtime ARN and on <runtime ARN>/runtime-endpoint/*."
        : "";
    child.logger.error(
      `AgentCore "${name}": StopRuntimeSession failed for session ${target.runtimeSessionId}. The session keeps running until the agent runtime's idle timeout ends it, or, while the handler still runs, until the runtime's maxLifetime.${hint}`,
      { error },
    );
  }
}

/**
 * Throws a retryable `TimeoutError` when the step has too little time left
 * before the invocation reserve to make its call. The step then makes no
 * call. See {@link tooLittleTimeMessage}.
 */
export function assertTimeToCall(
  child: DurableContext,
  name: string,
  step: string,
  action: string,
): void {
  const message = tooLittleTimeMessage(remainingTime(child), step, action);
  if (message !== undefined) {
    throw Object.assign(new Error(`AgentCore "${name}": ${message}`), {
      name: "TimeoutError",
    });
  }
}

/**
 * The error for a call that the invocation reserve stopped. Its name is
 * `TimeoutError`, which the default retry strategy retries.
 */
export function pastReserve(name: string, call: string): Error {
  return Object.assign(
    new Error(
      `AgentCore "${name}": ${call} did not end ${INVOCATION_RESERVE_MS / 1_000} seconds before the Lambda invocation times out, so the attempt stopped. A later attempt runs in a new invocation.`,
    ),
    { name: "TimeoutError" },
  );
}
