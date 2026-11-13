/**
 * Reads the agent runtime ARN that the integration test deploys with the
 * AgentCore examples. The SAM template sets `AGENT_RUNTIME_ARN` on every
 * example with `usesAgentcore`. The agent runtime runs `agentcore-agent/`.
 */
export function requireAgentcoreEnv(): { agentRuntimeArn: string } {
  const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN;
  if (!agentRuntimeArn) {
    throw new Error(
      "AGENT_RUNTIME_ARN must be set. Deploy agentcore-agent/ as an AgentCore Runtime agent.",
    );
  }
  return { agentRuntimeArn };
}
