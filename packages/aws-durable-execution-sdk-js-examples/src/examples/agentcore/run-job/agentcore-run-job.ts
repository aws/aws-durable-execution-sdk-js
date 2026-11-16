import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { agentcore } from "@aws/durable-execution-sdk-js-extras/compute/agentcore";
import { ExampleConfig } from "../../../types";
import { requireAgentcoreEnv } from "../../shared/agentcore-env";

export const config: ExampleConfig = {
  name: "AgentCore Run Job",
  description:
    "Runs one job in an Amazon Bedrock AgentCore Runtime agent and returns the result that the agent reports",
  durableConfig: {
    ExecutionTimeout: 900,
    RetentionPeriodInDays: 7,
  },
  // The CI test account has no agent runtime yet. So the example is left out
  // of the SAM template and the integration run. Its test is cloud-only, so
  // it does not run until the CI infrastructure exists and this flag is
  // removed. The function reads the agent runtime ARN from
  // AGENT_RUNTIME_ARN.
  localOnly: true,
};

export interface WordCount {
  wordCount: number;
  sha256: string;
  sessionId?: string;
}

export const handler = withDurableExecution(
  async (event: { text: string }, context: DurableContext) => {
    const { agentRuntimeArn } = requireAgentcoreEnv();

    // The operation starts a new session of the agent runtime with the job,
    // and waits on a durable callback. The worker in the agent runs the job
    // and completes the callback. The operation then stops the session.
    return agentcore<WordCount>(
      context,
      "count-words",
      { text: event.text },
      {
        agentRuntimeArn,
        timeout: { minutes: 5 },
        // An agent that stops sending heartbeats fails the operation after
        // this time, instead of after the timeout.
        heartbeatTimeout: { seconds: 60 },
      },
    );
  },
);
