import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import { defaultMicrovmRetryStrategy } from "../microvm/retry";
import { getClient, validateConfig } from "./agentcore";
import { createSessionId, type SessionTarget, stopSession } from "./steps";
import type { AgentcoreSession, AgentcoreSessionConfig } from "./types";

/**
 * The part of {@link AgentcoreSession} that the handler receives until
 * `invoke` exists.
 */
export type AgentcoreSessionHandle = Pick<AgentcoreSession, "runtimeSessionId">;

/**
 * Runs a handler in one Amazon Bedrock AgentCore Runtime session, and
 * returns the handler's value.
 *
 * @remarks
 * The operation creates its durable operations inside one child context
 * named `name`:
 *
 * 1. `<name>.session` generates the runtime session ID and checkpoints it.
 * 2. The handler runs with the session handle and the child context.
 * 3. `<name>.stop` calls StopRuntimeSession after the handler returns or
 *    throws.
 *
 * A stop failure does not fail the operation. The operation logs an error
 * and returns the handler's value or error.
 *
 * @param context - The context to create the durable operations in.
 * @param name - The child context name. It also prefixes the inner
 * operation names.
 * @param config - The agent runtime configuration.
 * @param handler - Receives the session handle and the session's child
 * context.
 * @returns The handler's return value.
 * @throws \{TypeError\} When `name` is empty, or `agentRuntimeArn` is not a
 * string.
 * @throws \{RangeError\} When `timeout` is shorter than 1 second.
 */
export function agentcoreSession<TOutput = unknown>(
  context: DurableContext,
  name: string,
  config: AgentcoreSessionConfig,
  handler: (
    session: AgentcoreSessionHandle,
    context: DurableContext,
  ) => Promise<TOutput>,
): DurablePromise<TOutput> {
  try {
    validateConfig(name, config);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
  }
  const retryStrategy = config.retryStrategy ?? defaultMicrovmRetryStrategy;

  return context.runInChildContext<TOutput>(name, async (child) => {
    const runtimeSessionId = await createSessionId(child, name);
    const target: SessionTarget = {
      agentRuntimeArn: config.agentRuntimeArn,
      runtimeSessionId,
      ...(config.qualifier !== undefined && { qualifier: config.qualifier }),
    };
    try {
      return await handler({ runtimeSessionId }, child);
    } finally {
      await stopSession(
        child,
        name,
        retryStrategy,
        () => getClient(config),
        target,
      );
    }
  });
}
