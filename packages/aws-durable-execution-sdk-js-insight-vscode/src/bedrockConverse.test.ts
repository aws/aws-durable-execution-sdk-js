const send = jest.fn();
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send })),
  ConverseCommand: jest.fn((input) => ({ __t: "converse", input })),
}));

import { sendConverse, modelRejectsTemperature } from "./bedrockConverse";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const client = { send } as never;

function lastInput() {
  const calls = (ConverseCommand as unknown as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => jest.clearAllMocks());

describe("modelRejectsTemperature", () => {
  it("flags Claude 5-gen (and newer) models", () => {
    expect(modelRejectsTemperature("us.anthropic.claude-sonnet-5")).toBe(true);
    expect(modelRejectsTemperature("anthropic.claude-opus-5")).toBe(true);
    expect(modelRejectsTemperature("global.anthropic.claude-haiku-9")).toBe(
      true,
    );
    // two-digit versions from 10 up
    expect(modelRejectsTemperature("anthropic.claude-sonnet-10")).toBe(true);
    expect(modelRejectsTemperature("anthropic.claude-opus-12")).toBe(true);
    // Opus 4.7+ rejects temperature despite being a 4-generation id
    expect(modelRejectsTemperature("us.anthropic.claude-opus-4-7")).toBe(true);
    expect(modelRejectsTemperature("anthropic.claude-opus-4-9")).toBe(true);
  });

  it("does not flag older models that accept temperature", () => {
    expect(
      modelRejectsTemperature("us.anthropic.claude-sonnet-4-20250514-v1:0"),
    ).toBe(false);
    expect(
      modelRejectsTemperature("anthropic.claude-3-5-sonnet-20241022-v2:0"),
    ).toBe(false);
    // Opus 4.5/4.6 still accept temperature (only 4.7+ rejects)
    expect(modelRejectsTemperature("anthropic.claude-opus-4-5")).toBe(false);
    // a hypothetical zero-padded low version must not false-match
    expect(modelRejectsTemperature("anthropic.claude-sonnet-04")).toBe(false);
  });
});

describe("sendConverse", () => {
  it("strips temperature up front for models that reject it (single call)", async () => {
    send.mockResolvedValue({ ok: true });
    await sendConverse(client, {
      modelId: "us.anthropic.claude-sonnet-5",
      messages: [],
      inferenceConfig: { maxTokens: 4096, temperature: 0 },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(lastInput().inferenceConfig).toEqual({ maxTokens: 4096 });
    expect(lastInput().inferenceConfig.temperature).toBeUndefined();
  });

  it("keeps temperature for models that accept it", async () => {
    send.mockResolvedValue({ ok: true });
    await sendConverse(client, {
      modelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      messages: [],
      inferenceConfig: { maxTokens: 4096, temperature: 0 },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(lastInput().inferenceConfig).toEqual({
      maxTokens: 4096,
      temperature: 0,
    });
  });

  it("retries without temperature when the server rejects it (unknown model)", async () => {
    send
      .mockRejectedValueOnce(
        new Error("`temperature` is deprecated for this model."),
      )
      .mockResolvedValueOnce({ ok: true });
    const out = await sendConverse(client, {
      modelId: "some.future.model",
      messages: [],
      inferenceConfig: { maxTokens: 100, temperature: 0 },
    });
    expect(out).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(lastInput().inferenceConfig).toEqual({ maxTokens: 100 });
  });

  it("rethrows non-temperature errors without retrying", async () => {
    send.mockRejectedValue(new Error("AccessDeniedException"));
    await expect(
      sendConverse(client, {
        modelId: "some.model",
        messages: [],
        inferenceConfig: { maxTokens: 100, temperature: 0 },
      }),
    ).rejects.toThrow("AccessDeniedException");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
