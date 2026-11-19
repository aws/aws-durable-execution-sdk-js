import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { AccessDeniedException } from "@aws-sdk/client-bedrock-agentcore";
import { agentcoreSession } from "../session";
import type { AgentcoreSessionConfig } from "../types";
import { FakeAgentcoreClient, metadata, RUNTIME_ARN, throwing } from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Runner = LocalDurableTestRunner<unknown>;

function runnerFor(
  operation: (context: DurableContext) => Promise<unknown>,
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => operation(context),
    ),
  }) as Runner;
}

const sessionConfig = (
  client: FakeAgentcoreClient,
  overrides: Partial<AgentcoreSessionConfig> = {},
): AgentcoreSessionConfig => ({
  agentRuntimeArn: RUNTIME_ARN,
  timeout: { minutes: 30 },
  client: client.asClient(),
  ...overrides,
});

const denied = () =>
  throwing(new AccessDeniedException({ message: "denied", ...metadata }));

describe("agentcoreSession", () => {
  it("returns the handler's value and stops the session after it", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client, { qualifier: "DEFAULT" }),
        async (session) => {
          // The handler runs before the stop.
          expect(client.stopInputs).toHaveLength(0);
          return { sessionId: session.runtimeSessionId };
        },
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    const sessionId = runner
      .getOperation("review.session")
      .getStepDetails()?.result;
    expect(execution.getResult()).toEqual({ sessionId });
    expect(client.stopInputs).toStrictEqual([
      {
        agentRuntimeArn: RUNTIME_ARN,
        runtimeSessionId: sessionId,
        qualifier: "DEFAULT",
      },
    ]);
  });

  it("stops the session after a handler error, and fails with that error", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(context, "review", sessionConfig(client), async () => {
        throw new Error("handler broke");
      }),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("handler broke");
    // Without a qualifier, the stop input has no qualifier key.
    expect(client.stopInputs).toStrictEqual([
      {
        agentRuntimeArn: RUNTIME_ARN,
        runtimeSessionId: runner.getOperation("review.session").getStepDetails()
          ?.result,
      },
    ]);
  });

  it("returns the handler's value when stop fails", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [denied()];
    const runner = runnerFor((context) =>
      agentcoreSession(
        context,
        "review",
        sessionConfig(client),
        async () => "ok",
      ),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    expect(
      runner.getOperation("review.stop").getStepDetails()?.error,
    ).toBeDefined();
  });

  it("keeps the handler's error when stop fails too", async () => {
    const client = new FakeAgentcoreClient();
    client.stopResponses = [denied()];
    const runner = runnerFor((context) =>
      agentcoreSession(context, "review", sessionConfig(client), async () => {
        throw new Error("handler broke");
      }),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("handler broke");
    expect(client.stopInputs).toHaveLength(1);
  });

  it("rejects an invalid config with a TypeError before any durable operation", async () => {
    const client = new FakeAgentcoreClient();
    const runner = runnerFor((context) =>
      agentcoreSession(context, "", sessionConfig(client), async () => "ok"),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getError()?.errorType).toBe("TypeError");
    expect(execution.getOperations()).toHaveLength(0);
  });
});
