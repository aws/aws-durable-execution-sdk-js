// The session-ID, job and stop steps of an AgentCore operation.
import { randomUUID } from "node:crypto";
import {
  type DurableContext,
  type Duration,
  defaultSerdes,
} from "@aws/durable-execution-sdk-js";
import {
  type BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  callBeforeDeadline,
  INVOCATION_RESERVE_MS,
  remainingTime,
  reserveStartsAt,
  tooLittleTimeMessage,
} from "../deadline";
import { inStage } from "./errors";
import { AgentcoreOperationSubType } from "./subtypes";
import type {
  AgentcoreConfig,
  AgentcoreInvokeOptions,
  AgentcoreJobDocument,
} from "./types";

/**
 * The error name of an InvokeAgentRuntime answer without
 * `{"accepted": true}`. The default retry strategy does not retry it,
 * because the same agent gives the same answer.
 */
const NOT_ACCEPTED_ERROR_NAME = "AgentcoreNotAcceptedError";

/** The longest part of a refused answer that the error message quotes. */
const MAX_QUOTED_ANSWER_CHARS = 256;

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
 * Runs one job in the session and returns the job's result.
 *
 * It creates the callback `<name>.callback`. The step `<name>.request`
 * then sends the job document to the session with InvokeAgentRuntime, and
 * the agent must answer `{"accepted": true}`. Then the function waits on the
 * callback. Then `stop` runs. It runs after success, failure and timeout
 * alike, and also after a failed request. A failed callback creation does
 * not run `stop`, because no job was sent.
 *
 * @param inputJson - The input's JSON text, or `undefined` when the input
 * encodes to no value. The job document holds this text as it is.
 * @param stop - Stops the session. It runs after the request step and the
 * wait, whatever their outcome.
 */
export async function runJob<TOutput>(
  child: DurableContext,
  name: string,
  options: AgentcoreInvokeOptions,
  retryStrategy: NonNullable<AgentcoreConfig["retryStrategy"]>,
  client: () => BedrockAgentCoreClient,
  target: SessionTarget,
  region: string,
  inputJson: string | undefined,
  stop: () => Promise<void>,
): Promise<TOutput> {
  const [result, callbackId] = (await child.createCallback<TOutput>(
    `${name}.callback`,
    {
      timeout: options.timeout,
      heartbeatTimeout: options.heartbeatTimeout,
      // The agent sends a JSON string, and the default callback
      // deserializer returns the raw string. So the callback parses it.
      serdes: defaultSerdes,
      subType: AgentcoreOperationSubType.CALLBACK,
    },
  )) as unknown as [Promise<TOutput>, string];
  const payload = jobDocumentJson(
    {
      version: 1,
      region,
      callbackId,
      ...(options.heartbeatTimeout !== undefined && {
        heartbeatTimeoutSeconds: durationToSeconds(options.heartbeatTimeout),
      }),
    },
    inputJson,
  );

  try {
    await inStage(name, "delivery", () =>
      child.step(
        `${name}.request`,
        async () => {
          assertTimeToCall(child, name, "request", "send the job");
          // The call and the read of the answer must end before the
          // invocation reserve. The abort signal covers both.
          await callBeforeDeadline(
            async (sendOptions) => {
              const response = await client().send(
                new InvokeAgentRuntimeCommand({
                  ...target,
                  contentType: "application/json",
                  accept: "application/json",
                  payload: Buffer.from(payload, "utf8"),
                }),
                sendOptions,
              );
              // The response body is a stream. Reading it to the end
              // releases the connection. The abort signal also ends the
              // read.
              const answer =
                (await response.response?.transformToString()) ?? "";
              if (!isAccepted(answer)) {
                throw Object.assign(
                  new Error(
                    `the agent did not accept the job. It must answer {"accepted": true}. Status ${response.statusCode}, answer: ${answer.slice(0, MAX_QUOTED_ANSWER_CHARS)}`,
                  ),
                  { name: NOT_ACCEPTED_ERROR_NAME },
                );
              }
            },
            reserveStartsAt(remainingTime(child)),
            () => pastReserve(name, "InvokeAgentRuntime"),
          );
        },
        { retryStrategy, subType: AgentcoreOperationSubType.REQUEST },
      ),
    );
    return await inStage(name, "job", () => result);
  } finally {
    await stop();
  }
}

/** Whether the agent's answer is the JSON object `{"accepted": true}`. */
function isAccepted(answer: string): boolean {
  try {
    return (JSON.parse(answer) as { accepted?: unknown })?.accepted === true;
  } catch {
    return false;
  }
}

/**
 * Returns the job document as JSON text. The input's text is inserted as it
 * is. So the document holds the text that the caller measured, and the
 * input is encoded once per call.
 */
function jobDocumentJson(
  fields: Omit<AgentcoreJobDocument, "input">,
  inputJson: string | undefined,
): string {
  const json = JSON.stringify(fields);
  return inputJson === undefined
    ? json
    : `${json.slice(0, -1)},"input":${inputJson}}`;
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
    // service keeps such a session alive. So the instance of a session whose
    // handler still runs ends only at the runtime's maxLifetime. An idle
    // session's instance ends at the idle timeout. A missing permission
    // fails every stop, and this log is the only sign of it. So it is an
    // error, not a warning, and it names the permission only for
    // AccessDeniedException.
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

/**
 * Converts a Duration to seconds without rounding, or `NaN` when it is
 * missing. The config checks compare this value with 1, so 0.5 seconds
 * fails.
 */
export function exactSeconds(duration: Duration | undefined): number {
  if (duration === undefined) {
    return Number.NaN;
  }
  const parts = duration as {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  };
  return (
    (parts.days ?? 0) * 86_400 +
    (parts.hours ?? 0) * 3_600 +
    (parts.minutes ?? 0) * 60 +
    (parts.seconds ?? 0)
  );
}

/**
 * Converts a Duration to whole seconds, rounding up. The job document
 * sends this value.
 */
export function durationToSeconds(duration: Duration | undefined): number {
  return Math.ceil(exactSeconds(duration));
}
