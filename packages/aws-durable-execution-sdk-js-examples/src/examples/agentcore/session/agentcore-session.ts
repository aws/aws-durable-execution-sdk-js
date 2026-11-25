import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { agentcoreSession } from "@aws/durable-execution-sdk-js-extensions/compute/agentcore";
import { ExampleConfig } from "../../../types";
import { requireAgentcoreEnv } from "../../shared/agentcore-env";

export const config: ExampleConfig = {
  name: "AgentCore Session",
  description:
    "Runs two jobs in one Amazon Bedrock AgentCore Runtime session, with a durable wait between them",
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
  async (event: { draft: string; final: string }, context: DurableContext) => {
    const { agentRuntimeArn } = requireAgentcoreEnv();

    // The operation generates one runtime session ID. Each session.invoke
    // sends one job to that session and waits on a durable callback. The
    // operation stops the session after the handler returns.
    return agentcoreSession(
      context,
      "word-counts",
      { agentRuntimeArn },
      async (session, child) => {
        const draft = await session.invoke<WordCount>(
          child,
          "count-draft",
          { text: event.draft },
          {
            timeout: { minutes: 5 },
            // An agent that stops sending heartbeats fails the job after this
            // time, instead of after the timeout.
            heartbeatTimeout: { seconds: 60 },
          },
        );

        // The function does not run during the wait. The wait must be
        // shorter than the agent runtime's idle timeout. Otherwise the next
        // job gets a new instance of the session.
        await child.wait("pause", { seconds: 10 });

        const final = await session.invoke<WordCount>(
          child,
          "count-final",
          { text: event.final },
          {
            timeout: { minutes: 5 },
            heartbeatTimeout: { seconds: 60 },
          },
        );

        return { draft, final, sessionId: session.runtimeSessionId };
      },
    );
  },
);
