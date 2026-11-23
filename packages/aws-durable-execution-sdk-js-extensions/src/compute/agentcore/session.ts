import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { defaultMicrovmRetryStrategy } from "../microvm/retry";
import {
  encodeInput,
  functionRegion,
  getClient,
  validateConfig,
  validateTarget,
} from "./agentcore";
import { agentcoreErrorMapper, agentcoreSessionErrorMapper } from "./errors";
import {
  createSessionId,
  runJob,
  type SessionTarget,
  stopSession,
} from "./steps";
import { AgentcoreOperationSubType } from "./subtypes";
import type {
  AgentcoreConfig,
  AgentcoreInvokeOptions,
  AgentcoreSession,
  AgentcoreSessionConfig,
} from "./types";

/**
 * Runs a handler in one Amazon Bedrock AgentCore Runtime session, and
 * returns the handler's value.
 *
 * @remarks
 * The operation creates its durable operations inside one child context
 * named `name`:
 *
 * 1. `<name>.session` generates the runtime session ID and checkpoints it.
 * 2. The handler runs with the {@link AgentcoreSession} and the child
 *    context. Each `session.invoke` sends one job to the session and waits
 *    for its result.
 * 3. `<name>.stop` calls StopRuntimeSession after the handler returns or
 *    throws.
 *
 * Each durable operation records a subtype from
 * {@link AgentcoreOperationSubType}: `AgentcoreSession` on the child
 * context, `AgentcoreSessionId` and `AgentcoreStop` on its steps, and
 * `AgentcoreSessionJob` on each job's child context. A job's callback and
 * request keep the `agentcore` subtypes. The operations that the handler
 * creates keep their own subtypes.
 *
 * The agent runtime's `maxLifetime` ends the current instance, not the
 * session. The same session ID then gets a new instance for the next job.
 * The memory and files outside configured session storage are lost. A job
 * that runs when the instance stops fails at its heartbeat timeout or its
 * job timeout.
 *
 * A stop failure does not fail the operation. The operation logs an error
 * and returns the handler's value or error.
 *
 * A failed `session.invoke` rejects inside the handler. The handler can
 * catch the error and continue with the same session. An error that leaves
 * the handler ends the session and reaches the caller. An AgentCore error
 * keeps its class. Any other error keeps its SDK error type, or is wrapped
 * in `ChildContextError`.
 *
 * @param context - The context to create the durable operations in.
 * @param name - The child context name. It also prefixes the inner
 * operation names.
 * @param config - The agent runtime configuration.
 * @param handler - Receives the session and the session's child context.
 * @returns The handler's return value.
 * @throws \{TypeError\} When `name` is empty, or `agentRuntimeArn` is not a
 * string.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function agentcoreSession<TOutput = unknown>(
  context: DurableContext,
  name: string,
  config: AgentcoreSessionConfig,
  handler: (
    session: AgentcoreSession,
    context: DurableContext,
  ) => Promise<TOutput>,
): DurablePromise<TOutput> {
  try {
    validateTarget(name, config);
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
      const session: AgentcoreSession = {
        runtimeSessionId,
        invoke: <TJobOutput = unknown, TInput = unknown>(
          jobContext: DurableContext,
          jobName: string,
          input: TInput,
          options: AgentcoreInvokeOptions,
        ): DurablePromise<TJobOutput> =>
          invokeJob<TJobOutput>(
            jobContext,
            jobName,
            input,
            options,
            retryStrategy,
            client,
            target,
          ),
      };
      try {
        return await handler(session, child);
      } finally {
        await stopSession(child, name, retryStrategy, client, target);
      }
    },
    {
      subType: AgentcoreOperationSubType.SESSION,
      errorMapper: agentcoreSessionErrorMapper,
    },
  );
}

/**
 * Sends one job to the session and waits for its result.
 *
 * The job has the same shape as `agentcore`, without its own session ID and
 * stop: a child context named `jobName` in `context`, a callback
 * `<jobName>.callback`, and a request step `<jobName>.request`. The session
 * stops the session, so the job's `stop` does nothing.
 */
function invokeJob<TOutput>(
  context: DurableContext,
  jobName: string,
  input: unknown,
  options: AgentcoreInvokeOptions,
  retryStrategy: NonNullable<AgentcoreConfig["retryStrategy"]>,
  client: () => BedrockAgentCoreClient,
  target: SessionTarget,
): DurablePromise<TOutput> {
  let region: string;
  let inputJson: string | undefined;
  try {
    validateConfig(jobName, {
      agentRuntimeArn: target.agentRuntimeArn,
      timeout: options.timeout,
      heartbeatTimeout: options.heartbeatTimeout,
    });
    region = functionRegion(jobName);
    inputJson = encodeInput(jobName, input);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
  }

  return context.runInChildContext<TOutput>(
    jobName,
    (jobContext) =>
      runJob<TOutput>(
        jobContext,
        jobName,
        options,
        retryStrategy,
        client,
        target,
        region,
        inputJson,
        async () => {},
      ),
    {
      subType: AgentcoreOperationSubType.SESSION_JOB,
      errorMapper: agentcoreErrorMapper(jobName),
    },
  );
}
