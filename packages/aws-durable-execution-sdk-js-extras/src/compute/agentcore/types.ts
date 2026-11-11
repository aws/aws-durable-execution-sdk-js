import type { Duration, RetryDecision } from "@aws/durable-execution-sdk-js";
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
   * The maximum time to wait for the agent to report a result.
   *
   * An agent runtime session lives at most 8 hours. So the timeout must be
   * between 1 second and 8 hours.
   */
  timeout: Duration;

  /**
   * The maximum time between two heartbeats from the agent.
   *
   * When it is set, an agent that stops responding fails the operation after
   * this duration, instead of after `timeout`. The agent receives this value
   * in the job document.
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
