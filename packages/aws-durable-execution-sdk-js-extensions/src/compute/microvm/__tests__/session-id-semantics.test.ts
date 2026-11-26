import { describe, it, expect } from "vitest";
import {
  type DurableContext,
  DurablePromise,
  StepSemantics,
} from "@aws/durable-execution-sdk-js";
import { microvmSession } from "..";
import { createSessionId } from "../../agentcore/steps";
import { baseConfig, FakeEndpoint, FakeMicrovmsClient } from "./fakes";

/**
 * The session ID feeds a client token or a runtime session. So its step must be saved
 * before the next step runs, whatever DurableExecutionConfig.defaultStepSemantics says.
 */
const stop = new Error("stop after the session step");

/** A child context whose first step records its options and then stops the run. */
function recordingChild(calls: { name: string; options: unknown }[]) {
  return {
    step: (name: string, _fn: unknown, options: unknown) => {
      calls.push({ name, options });
      return Promise.reject(stop);
    },
  } as unknown as DurableContext;
}

describe("session ID step semantics", () => {
  it("pins AtLeastOnce on the microvmSession session step", async () => {
    const calls: { name: string; options: unknown }[] = [];
    const child = recordingChild(calls);
    const context = {
      executionContext: {
        durableExecutionArn: "arn:aws:lambda:us-east-1:1:function:f",
      },
      runInChildContext: (_name: string, fn: (c: DurableContext) => unknown) =>
        new DurablePromise(() => Promise.resolve(fn(child))),
    } as unknown as DurableContext;

    await expect(
      microvmSession(
        context,
        "pipeline",
        {
          ...baseConfig(new FakeMicrovmsClient()),
          timeout: { hours: 1 },
          fetch: new FakeEndpoint().fetch,
        },
        async () => undefined,
      ),
    ).rejects.toBe(stop);

    expect(calls[0]).toMatchObject({
      name: "pipeline.session",
      options: { semantics: StepSemantics.AtLeastOnce },
    });
  });

  it("pins AtLeastOnce on the AgentCore session step", async () => {
    const calls: { name: string; options: unknown }[] = [];

    await expect(createSessionId(recordingChild(calls), "agent")).rejects.toBe(
      stop,
    );

    expect(calls[0]).toMatchObject({
      name: "agent.session",
      options: { semantics: StepSemantics.AtLeastOnce },
    });
  });
});
