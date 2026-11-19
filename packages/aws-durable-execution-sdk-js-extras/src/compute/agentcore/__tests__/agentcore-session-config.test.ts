import { describe, expect, it } from "vitest";
import { validateConfig } from "../agentcore";
import type { AgentcoreSessionConfig } from "../types";

const config: AgentcoreSessionConfig = {
  agentRuntimeArn:
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/agent",
  timeout: { minutes: 30 },
};

describe("validateConfig with an AgentcoreSessionConfig", () => {
  it("accepts a valid config", () => {
    expect(() => validateConfig("session", config)).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => validateConfig("", config)).toThrow(
      new TypeError("an AgentCore operation requires a non-empty name"),
    );
  });

  it("rejects a name that is not a string", () => {
    expect(() => validateConfig(1 as unknown as string, config)).toThrow(
      new TypeError("an AgentCore operation requires a non-empty name"),
    );
  });

  it("rejects a config without a runtime ARN", () => {
    const noArn = { ...config, agentRuntimeArn: undefined };
    expect(() =>
      validateConfig("session", noArn as unknown as AgentcoreSessionConfig),
    ).toThrow(
      new TypeError('AgentCore "session": agentRuntimeArn is required'),
    );
  });

  it("rejects a timeout shorter than 1 second", () => {
    expect(() =>
      validateConfig("session", { ...config, timeout: { seconds: 0 } }),
    ).toThrow(
      new RangeError(
        'AgentCore "session": timeout must be at least 1 second. Got 0 seconds.',
      ),
    );
  });
});
