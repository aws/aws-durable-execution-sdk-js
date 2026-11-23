import type {
  DurableContext,
  DurablePromise,
  Duration,
  RetryDecision,
} from "@aws/durable-execution-sdk-js";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";

/**
 * Configuration for {@link agentcore}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreConfig {
  /**
   * The ARN of the agent runtime that runs the job. The developer deploys
   * the agent runtime outside the durable function.
   *
   * The operation sends InvokeAgentRuntime and StopRuntimeSession to the
   * Region in this ARN.
   */
  agentRuntimeArn: string;

  /**
   * The endpoint name or version of the agent runtime, such as `DEFAULT`.
   * The operation passes it to InvokeAgentRuntime and StopRuntimeSession
   * when it is set. Without it, the service uses its default endpoint.
   */
  qualifier?: string;

  /**
   * The maximum time to wait for the agent to report a result. It must be
   * at least 1 second.
   *
   * The agent runtime's `maxLifetime` ends the session's instance, and the
   * job ends with it. `maxLifetime` is at most 8 hours for a microVM
   * runtime, and up to 14 days for a runtime on Instances. The operation
   * cannot read the runtime's setting. So set a timeout that fits the
   * configured `maxLifetime`. With a longer timeout, a job that ends with
   * its instance fails only at its heartbeat timeout or its timeout.
   */
  timeout: Duration;

  /**
   * The maximum time between two heartbeats from the agent.
   *
   * When it is set, an agent that stops responding fails the operation after
   * this duration, instead of after `timeout`. The agent receives this value
   * in the job document. It ends the job when the worker crashes or stops
   * reporting. The first heartbeat period starts before the job is
   * delivered. So it must cover the request retries and a cold session
   * start, which took 1.4 to 3.1 seconds in a live test. Use 30 seconds or
   * more.
   */
  heartbeatTimeout?: Duration;

  /**
   * The step retry strategy for the request and stop steps.
   *
   * Defaults to `defaultMicrovmRetryStrategy` from the `compute/microvm`
   * subpath. It retries throttling, server errors, connection failures, and
   * any error that the AWS SDK marks as retryable, 5 attempts in total.
   */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;

  /**
   * The client for the Amazon Bedrock AgentCore data plane API.
   *
   * Defaults to one client per Region, created on first use. The Region
   * comes from `agentRuntimeArn`.
   */
  client?: BedrockAgentCoreClient;
}

/**
 * The JSON document that {@link agentcore} sends as the InvokeAgentRuntime
 * payload.
 *
 * @remarks
 * The same type is declared in
 * `@aws/durable-execution-sdk-js-compute-worker/agentcore`. The two packages
 * do not depend on each other, because one runs in the function and the
 * other in the agent runtime. So a change to one declaration must be made
 * in the other too.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreJobDocument<TInput = unknown> {
  /** The document format version. */
  version: 1;
  /** The Region of the durable function, for the callback API calls. */
  region: string;
  /** The callback ID that the agent completes with the job's outcome. */
  callbackId: string;
  /** The heartbeat timeout in seconds, when the caller set one. */
  heartbeatTimeoutSeconds?: number;
  /**
   * The caller's input. The document has no `input` field when the input
   * encodes to no value, such as `undefined`.
   */
  input: TInput;
}

/**
 * Configuration for `agentcoreSession`.
 *
 * @remarks
 * The session sends every job to one runtime session ID. The jobs share the
 * session's memory and files only while the same microVM serves that ID.
 * After the agent runtime's idle timeout (`idleRuntimeSessionTimeout`), the
 * same session ID gets a new microVM, and the memory and files of the old
 * one are lost. So set the idle timeout longer than any wait between two
 * jobs, such as a durable wait or a callback.
 *
 * The agent runtime's `maxLifetime` ends the current instance, not the
 * session. The same session ID then gets a new instance for the next job.
 * The memory and files outside configured session storage are lost. A job
 * that runs when the instance stops fails at its heartbeat timeout or its
 * job timeout.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreSessionConfig
  extends Pick<
    AgentcoreConfig,
    "agentRuntimeArn" | "qualifier" | "retryStrategy" | "client"
  > {}

/**
 * Options for one {@link AgentcoreSession.invoke} call.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreInvokeOptions {
  /**
   * The maximum time to wait for the agent to report this job's result. It
   * must be at least 1 second.
   *
   * The agent runtime's `maxLifetime` ends the session's current instance.
   * A job that runs when the instance stops fails at its heartbeat timeout
   * or at this timeout. The next job gets a new instance.
   */
  timeout: Duration;

  /**
   * The maximum time between two heartbeats from the agent for this job.
   *
   * The first heartbeat period starts before the job is delivered. So it
   * must cover the request retries and a cold session start. Use 30 seconds
   * or more.
   */
  heartbeatTimeout?: Duration;
}

/**
 * The handle that an `agentcoreSession` handler receives.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreSession {
  /** The runtime session ID that every job of the session uses. */
  readonly runtimeSessionId: string;

  /**
   * Sends one job to the session and returns the job's result.
   *
   * @remarks
   * Each call creates a child context named `name` in `context`. Pass the
   * context that the call runs in: the session's child context, or a nested
   * one, such as a `map` item's context. Two calls that run at the same time
   * reach the same session, and the agent must handle that.
   *
   * @throws \{AgentcoreJobFailedError\} When the agent reports a failure.
   * @throws \{AgentcoreTimeoutError\} When the job or its heartbeat times
   * out.
   * @throws \{AgentcoreDeliveryError\} When the request fails after all
   * retries, or the agent does not accept the job.
   */
  invoke<TOutput = unknown, TInput = unknown>(
    context: DurableContext,
    name: string,
    input: TInput,
    options: AgentcoreInvokeOptions,
  ): DurablePromise<TOutput>;
}
