import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { defaultMicrovmRetryStrategy } from "../microvm/retry";
import { agentcoreErrorMapper } from "./errors";
import {
  createSessionId,
  exactSeconds,
  runJob,
  type SessionTarget,
  stopSession,
} from "./steps";
import { AgentcoreOperationSubType } from "./subtypes";
import type { AgentcoreConfig } from "./types";

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
 * once per process, and answers a repeat without running it again. The
 * worker keeps the callback IDs in memory. A retry can reach a new process,
 * for example after the idle timeout replaced the old one. The new process
 * does not know the callback ID, so it runs the job again. So delivery is
 * at least once, and the job handler's side effects must be idempotent.
 *
 * InvokeAgentRuntime and StopRuntimeSession each stop 10 seconds before the
 * Lambda invocation times out. A Lambda timeout during a step attempt would
 * record no outcome for the attempt. A call that stops this way fails its
 * attempt with a retryable `TimeoutError`, so the step retries in a later
 * invocation. So the function timeout must be at least 11 seconds. With
 * less time left, the request and stop steps make no call and fail with a
 * message that says to raise the function timeout.
 *
 * The operation sends one job per session. After the agent runtime's
 * `idleRuntimeSessionTimeout`, the same session ID silently gets a new
 * microVM, and the memory and files of the old one are lost. One job per
 * session keeps that safe: no later job can reach the new microVM. The idle
 * timeout matters only while the job runs. The worker then reports
 * `HealthyBusy`, and the service keeps such a session alive.
 *
 * The function's execution role needs `bedrock-agentcore:InvokeAgentRuntime`
 * and `bedrock-agentcore:StopRuntimeSession` on both the agent runtime ARN
 * and `<runtime ARN>/runtime-endpoint/*`. The service checks the endpoint
 * resource too, such as `<runtime ARN>/runtime-endpoint/DEFAULT`.
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
 * @throws \{RangeError\} When `timeout` is shorter than 1 second, or the
 * JSON form of `input` is too large.
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
      const runtimeSessionId = await createSessionId(child, name);
      const target: SessionTarget = {
        agentRuntimeArn: config.agentRuntimeArn,
        runtimeSessionId,
        ...(config.qualifier !== undefined && { qualifier: config.qualifier }),
      };
      return await runJob<TOutput>(
        child,
        name,
        config,
        retryStrategy,
        client,
        target,
        region,
        inputJson,
        () => stopSession(child, name, retryStrategy, client, target),
      );
    },
    {
      subType: AgentcoreOperationSubType.AGENTCORE,
      errorMapper: agentcoreErrorMapper(name),
    },
  );
}

/**
 * Checks the name and the runtime ARN. `agentcoreSession` calls it before
 * any durable operation.
 */
export function validateTarget(
  name: string,
  config: Pick<AgentcoreConfig, "agentRuntimeArn">,
): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("an AgentCore operation requires a non-empty name");
  }
  if (typeof config?.agentRuntimeArn !== "string") {
    throw new TypeError(`AgentCore "${name}": agentRuntimeArn is required`);
  }
}

/**
 * Checks the name, the runtime ARN and the timeout. {@link agentcore} and
 * each session job call it before any durable operation.
 */
export function validateConfig(
  name: string,
  config: Pick<
    AgentcoreConfig,
    "agentRuntimeArn" | "timeout" | "heartbeatTimeout"
  >,
): void {
  validateTarget(name, config);
  // The agent runtime's maxLifetime limits the instance: 8 hours for a
  // microVM runtime, up to 14 days for a runtime on Instances. The ARN does
  // not say which one the runtime uses. So only the lower limit is checked.
  const seconds = exactSeconds(config.timeout);
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new RangeError(
      `AgentCore "${name}": timeout must be at least 1 second. Got ${seconds} seconds.`,
    );
  }
  // The worker refuses a heartbeat timeout under 1 second.
  if (config.heartbeatTimeout !== undefined) {
    const heartbeatSeconds = exactSeconds(config.heartbeatTimeout);
    if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 1) {
      throw new RangeError(
        `AgentCore "${name}": heartbeatTimeout must be at least 1 second. Got ${heartbeatSeconds} seconds.`,
      );
    }
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
export function encodeInput(name: string, input: unknown): string | undefined {
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
 * Returns the Region of the durable function. The agent sends the job's
 * callbacks there. Lambda sets `AWS_REGION` to the function's Region.
 *
 * @throws \{TypeError\} When `AWS_REGION` is not set, for example in a local
 * test without it. The worker rejects a job document without a Region. So
 * the operation fails before any durable operation instead.
 */
export function functionRegion(name: string): string {
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
 * `arn:<partition>:bedrock-agentcore:<region>:...`. {@link agentcore} and
 * `agentcoreSession` share the default clients.
 */
export function getClient(
  config: Pick<AgentcoreConfig, "agentRuntimeArn" | "client">,
): BedrockAgentCoreClient {
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
