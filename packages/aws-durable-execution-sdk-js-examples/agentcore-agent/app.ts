// The agent that the AgentCore examples run, in an Amazon Bedrock AgentCore
// Runtime agent runtime.
//
// AgentCore Runtime starts this process in each new session. The worker
// listens on 0.0.0.0:8080, receives the job, runs it, and reports the result
// to the durable function's callback.
//
// To deploy it, bundle this file with its dependencies into one ES module
// file, for example with esbuild. Deploy the bundle as a direct code
// deployment of an agent runtime with the NODE_22 runtime. The agent
// runtime's execution role needs
// lambda:SendDurableExecutionCallbackSuccess,
// lambda:SendDurableExecutionCallbackFailure, and
// lambda:SendDurableExecutionCallbackHeartbeat on the example functions.
// The integration test passes the agent runtime ARN to the example functions
// as AGENT_RUNTIME_ARN.
import { createHash } from "node:crypto";
import { startAgentcoreWorker } from "@aws/durable-execution-sdk-js-compute-worker/agentcore";

await startAgentcoreWorker({
  handler: async (input: unknown, context) => {
    const { text } = input as { text: string };
    return {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      sha256: createHash("sha256").update(text).digest("hex"),
      sessionId: context.sessionId,
    };
  },
});
