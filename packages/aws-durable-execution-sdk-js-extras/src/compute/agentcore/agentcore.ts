import { randomUUID } from "node:crypto";
import {
  type DurableContext,
  DurablePromise,
  type Duration,
  defaultSerdes,
} from "@aws/durable-execution-sdk-js";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { defaultMicrovmRetryStrategy } from "../microvm/retry";
import { agentcoreErrorMapper, inStage } from "./errors";
import { AgentcoreOperationSubType } from "./subtypes";
import type { AgentcoreConfig, AgentcoreJobDocument } from "./types";

/**
 * An agent runtime session lives at most 8 hours: `maxLifetime` is at most
 * 28,800 seconds.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_AGENTCORE_JOB_SECONDS = 28_800;

/**
 * The largest job input that {@link agentcore} accepts, in UTF-8 bytes of its
 * JSON form: 6 MiB minus 8 KiB.
 *
 * InvokeAgentRuntime accepts a payload of up to 100 MB. The operation keeps
 * the input limit of the `microvm` operation. So the same input fits both
 * compute types, and the worker can refuse any body over 6 MiB.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_AGENTCORE_JOB_INPUT_BYTES = 6 * 1024 * 1024 - 8 * 1024;

/**
 * The error name of an InvokeAgentRuntime answer without
 * `{"accepted": true}`. The default retry strategy does not retry it,
 * because the same agent gives the same answer.
 */
const NOT_ACCEPTED_ERROR_NAME = "AgentcoreNotAcceptedError";

/** The longest part of a refused answer that the error message quotes. */
const MAX_QUOTED_ANSWER_CHARS = 256;

const defaultClients = new Map<string | undefined, BedrockAgentCoreClient>();

/**
 * Runs one job in a new Amazon Bedrock AgentCore Runtime session and returns
 * the job's result.
 *
 * @remarks
 * The operation creates its durable operations inside one child context named
 * `name`:
 *
 * 1. `<name>.session` generates the runtime session ID, a UUID. The SDK
 *    checkpoints it. So every replay and every retry of the request uses the
 *    same session.
 * 2. `<name>.callback` creates a durable callback.
 * 3. `<name>.request` calls InvokeAgentRuntime with the job document. The
 *    first request with a new session ID starts the session. The agent must
 *    answer `{"accepted": true}` at once and run the job in the background.
 *    `@aws/durable-execution-sdk-js-compute-worker/agentcore` does that.
 * 4. The child context waits on the callback. The invocation ends while it
 *    waits, so no Lambda compute is billed. The agent completes the callback
 *    with its result or its failure.
 * 5. `<name>.stop` calls StopRuntimeSession. It runs after success, failure,
 *    and timeout alike, and also after a failed request.
 *
 * InvokeAgentRuntime has no idempotency token. So a retried request step can
 * deliver the job to the session twice. The worker accepts each callback ID
 * once per process, and answers a repeat without running it again.
 *
 * The operation keeps no session across jobs. The agent runtime ends a
 * session that receives no request for its `idleRuntimeSessionTimeout`. The
 * worker reports `HealthyBusy` while a job runs, and the service keeps such
 * a session alive. Set the idle timeout on the agent runtime.
 *
 * A stop failure does not fail the operation. The job result is already
 * recorded when stop runs, and the agent runtime ends an idle session on its
 * own. So the operation logs an error and returns the job's outcome.
 *
 * @param context - The context to create the durable operations in.
 * @param name - The child context name. It also prefixes the inner
 * operation names.
 * @param input - The job input. It must be JSON-serializable, and it must be
 * the same on every replay. Its JSON form must have at most
 * {@link MAX_AGENTCORE_JOB_INPUT_BYTES} UTF-8 bytes.
 * @param config - The agent runtime and callback configuration.
 * @returns The value that the agent passed to
 * `SendDurableExecutionCallbackSuccess`, parsed as JSON.
 * @throws \{TypeError\} When `name` is empty, `agentRuntimeArn` is not a
 * string, the Region of the function cannot be determined, or
 * `JSON.stringify` cannot encode `input`.
 * @throws \{RangeError\} When `timeout` is not between 1 second and 8 hours,
 * or the JSON form of `input` is too large.
 * @throws \{AgentcoreDeliveryError\} When InvokeAgentRuntime fails after all
 * retries, or the agent does not accept the job.
 * @throws \{AgentcoreJobFailedError\} When the agent reports a failure.
 * @throws \{AgentcoreTimeoutError\} When no result or heartbeat arrives in
 * time.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function agentcore<TOutput = unknown, TInput = unknown>(
  context: DurableContext,
  name: string,
  input: TInput,
  config: AgentcoreConfig,
): DurablePromise<TOutput> {
  let region: string;
  let inputJson: string | undefined;
  try {
    validateConfig(name, config);
    region = functionRegion(name);
    inputJson = encodeInput(name, input);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
  }
  const retryStrategy = config.retryStrategy ?? defaultMicrovmRetryStrategy;
  const client = (): BedrockAgentCoreClient => getClient(config);

  return context.runInChildContext<TOutput>(
    name,
    async (child) => {
      const runtimeSessionId = (await child.step(
        `${name}.session`,
        async () => randomUUID(),
        { subType: AgentcoreOperationSubType.SESSION_ID },
      )) as string;
      const [result, callbackId] = (await child.createCallback<TOutput>(
        `${name}.callback`,
        {
          timeout: config.timeout,
          heartbeatTimeout: config.heartbeatTimeout,
          // The agent sends a JSON string, and the default callback
          // deserializer returns the raw string. So the callback parses it.
          serdes: defaultSerdes,
          subType: AgentcoreOperationSubType.CALLBACK,
        },
      )) as unknown as [Promise<TOutput>, string];
      const target = {
        agentRuntimeArn: config.agentRuntimeArn,
        runtimeSessionId,
        ...(config.qualifier !== undefined && { qualifier: config.qualifier }),
      };
      const payload = jobDocumentJson(
        {
          version: 1,
          region,
          callbackId,
          ...(config.heartbeatTimeout !== undefined && {
            heartbeatTimeoutSeconds: durationToSeconds(config.heartbeatTimeout),
          }),
        },
        inputJson,
      );

      try {
        await inStage(name, "delivery", () =>
          child.step(
            `${name}.request`,
            async () => {
              const response = await client().send(
                new InvokeAgentRuntimeCommand({
                  ...target,
                  contentType: "application/json",
                  accept: "application/json",
                  payload: Buffer.from(payload, "utf8"),
                }),
              );
              // The response body is a stream. Reading it to the end
              // releases the connection.
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
            { retryStrategy, subType: AgentcoreOperationSubType.REQUEST },
          ),
        );
        return await inStage(name, "job", () => result);
      } finally {
        await stop(child, name, retryStrategy, client, target);
      }
    },
    {
      subType: AgentcoreOperationSubType.AGENTCORE,
      errorMapper: agentcoreErrorMapper(name),
    },
  );
}

/**
 * Stops the runtime session and logs, instead of throwing, a final failure.
 *
 * When stop runs, the callback already holds the job's outcome. So a stop
 * failure must not replace that outcome. The step's failure is checkpointed.
 * So on replay the step fails again at once, this function catches it again,
 * and the outcome stays the same.
 */
async function stop(
  child: DurableContext,
  name: string,
  retryStrategy: NonNullable<AgentcoreConfig["retryStrategy"]>,
  client: () => BedrockAgentCoreClient,
  target: {
    agentRuntimeArn: string;
    runtimeSessionId: string;
    qualifier?: string;
  },
): Promise<void> {
  try {
    await child.step(
      `${name}.stop`,
      async () => {
        try {
          await client().send(new StopRuntimeSessionCommand(target));
        } catch (error) {
          // A session that the idle timeout or the maximum lifetime already
          // ended has nothing to stop. Unverified: that the service answers
          // ResourceNotFoundException for such a session. The API model
          // lists that error for StopRuntimeSession.
          if ((error as Error).name !== "ResourceNotFoundException") {
            throw error;
          }
        }
      },
      { retryStrategy, subType: AgentcoreOperationSubType.STOP },
    );
  } catch (error) {
    // The job's outcome is already recorded, so the operation still returns
    // it. The session keeps running until its idle timeout ends it. A
    // missing permission fails every stop this way, and this log is the only
    // sign of it. So it is an error, not a warning.
    child.logger.error(
      `AgentCore "${name}": StopRuntimeSession failed for session ${target.runtimeSessionId}. The session keeps running until the agent runtime's idle timeout ends it. A missing permission needs bedrock-agentcore:StopRuntimeSession on the agent runtime in the function's execution role.`,
      { error },
    );
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

function validateConfig(name: string, config: AgentcoreConfig): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("an AgentCore operation requires a non-empty name");
  }
  if (typeof config?.agentRuntimeArn !== "string") {
    throw new TypeError(`AgentCore "${name}": agentRuntimeArn is required`);
  }
  const seconds = durationToSeconds(config.timeout);
  if (
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > MAX_AGENTCORE_JOB_SECONDS
  ) {
    throw new RangeError(
      `AgentCore "${name}": timeout must be between 1 second and ${MAX_AGENTCORE_JOB_SECONDS} seconds (8 hours), because an agent runtime session lives at most 8 hours. Got ${seconds} seconds.`,
    );
  }
}

/** The text before the input's JSON in `JSON.stringify({ input })`. */
const INPUT_MEMBER_PREFIX = '{"input":';

/**
 * Encodes the input once, and checks its size.
 *
 * The input is encoded as the value of the key `input`, because the job
 * document holds it under that key. A `toJSON` method receives that key. So
 * the measured text is the text that the document sends.
 *
 * @returns The input's JSON text, or `undefined` when the input encodes to
 * no value, such as `undefined`. The document then has no `input` field.
 */
function encodeInput(name: string, input: unknown): string | undefined {
  let json: string;
  try {
    json = JSON.stringify({ input });
  } catch (error) {
    throw new TypeError(
      `AgentCore "${name}": the job input must be JSON-serializable: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (json === "{}") {
    return undefined;
  }
  const inputJson = json.slice(INPUT_MEMBER_PREFIX.length, -1);
  const bytes = Buffer.byteLength(inputJson, "utf8");
  if (bytes > MAX_AGENTCORE_JOB_INPUT_BYTES) {
    throw new RangeError(
      `AgentCore "${name}": the job input is ${bytes} bytes as JSON. The limit is ${MAX_AGENTCORE_JOB_INPUT_BYTES} bytes. Pass larger data by reference, for example as an S3 key.`,
    );
  }
  return inputJson;
}

/**
 * Returns the job document as JSON text. The input's text is inserted as it
 * is. So the document holds the text that {@link encodeInput} measured, and
 * the input is encoded once per call.
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
 * Returns the Region of the durable function. The agent sends the job's
 * callbacks there. Lambda sets `AWS_REGION` to the function's Region.
 *
 * @throws \{TypeError\} When `AWS_REGION` is not set, for example in a local
 * test without it. The worker rejects a job document without a Region. So
 * the operation fails before any durable operation instead.
 */
function functionRegion(name: string): string {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new TypeError(
      `AgentCore "${name}": cannot determine the AWS Region of the function, because AWS_REGION is not set.`,
    );
  }
  return region;
}

/**
 * Returns the configured client, or one default client per Region. The
 * Region is the agent runtime's, from its ARN, in the form
 * `arn:<partition>:bedrock-agentcore:<region>:...`.
 */
function getClient(config: AgentcoreConfig): BedrockAgentCoreClient {
  if (config.client) {
    return config.client;
  }
  const region = config.agentRuntimeArn.split(":")[3];
  let client = defaultClients.get(region);
  if (!client) {
    client = new BedrockAgentCoreClient({ region });
    defaultClients.set(region, client);
  }
  return client;
}

/** Converts a Duration to whole seconds, rounding up. */
function durationToSeconds(duration: Duration | undefined): number {
  if (duration === undefined) {
    return Number.NaN;
  }
  const parts = duration as {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  };
  return Math.ceil(
    (parts.days ?? 0) * 86_400 +
      (parts.hours ?? 0) * 3_600 +
      (parts.minutes ?? 0) * 60 +
      (parts.seconds ?? 0),
  );
}
