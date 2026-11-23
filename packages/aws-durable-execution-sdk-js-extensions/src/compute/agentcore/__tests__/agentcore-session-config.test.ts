import { describe, expect, it } from "vitest";
import { validateTarget } from "../agentcore";
import type { AgentcoreSessionConfig } from "../types";

const config: AgentcoreSessionConfig = {
  agentRuntimeArn:
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/agent",
};

describe("validateTarget with an AgentcoreSessionConfig", () => {
  it("accepts a valid config", () => {
    expect(() => validateTarget("session", config)).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => validateTarget("", config)).toThrow(
      new TypeError("an AgentCore operation requires a non-empty name"),
    );
  });

  it("rejects a name that is not a string", () => {
    expect(() => validateTarget(1 as unknown as string, config)).toThrow(
      new TypeError("an AgentCore operation requires a non-empty name"),
    );
  });

  it("rejects a config without a runtime ARN", () => {
    const noArn = { ...config, agentRuntimeArn: undefined };
    expect(() =>
      validateTarget("session", noArn as unknown as AgentcoreSessionConfig),
    ).toThrow(
      new TypeError('AgentCore "session": agentRuntimeArn is required'),
    );
  });
});
