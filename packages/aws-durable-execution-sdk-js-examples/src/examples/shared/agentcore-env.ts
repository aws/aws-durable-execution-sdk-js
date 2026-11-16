/**
 * Reads the agent runtime ARN of the AgentCore examples from
 * `AGENT_RUNTIME_ARN`. The agent runtime runs `agentcore-agent/`.
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
