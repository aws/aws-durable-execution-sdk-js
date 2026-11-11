/**
 * Subtypes that `agentcore` records on its durable operations. Execution
 * history and plugins can filter on them without parsing operation names.
 *
 * Replay compares each subtype with the checkpoint. So a changed value is a
 * breaking change for executions in flight, and these values must stay fixed.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const AgentcoreOperationSubType = {
  /** The child context of an `agentcore` call. */
  AGENTCORE: "Agentcore",
  /** The step that generates and checkpoints the runtime session ID. */
  SESSION_ID: "AgentcoreSessionId",
  /** The callback that the agent completes with the job result. */
  CALLBACK: "AgentcoreCallback",
  /** The step that calls InvokeAgentRuntime with the job. */
  REQUEST: "AgentcoreRequest",
  /** The step that calls StopRuntimeSession. */
  STOP: "AgentcoreStop",
} as const;

/**
 * One value of {@link AgentcoreOperationSubType}.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type AgentcoreOperationSubType =
  (typeof AgentcoreOperationSubType)[keyof typeof AgentcoreOperationSubType];
