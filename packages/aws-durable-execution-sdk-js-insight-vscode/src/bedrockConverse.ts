import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type InferenceConfiguration,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Whether a Bedrock model rejects the `temperature` inference parameter.
 * Claude Sonnet/Opus/Haiku 5 (and newer) have adaptive reasoning that is always
 * on, and the Converse API returns "`temperature` is deprecated for this model"
 * if it's supplied.
 */
export function modelRejectsTemperature(modelId: string): boolean {
  // Claude family version 5+ (single digit 5-9, or any two-digit version
  // starting at 10) — e.g. claude-sonnet-5, claude-opus-12. The two-digit
  // branch starts at 10 (not \d\d) so a hypothetical claude-*-04 wouldn't
  // false-match.
  if (/claude-(sonnet|opus|haiku)-([5-9]|[1-9]\d)/i.test(modelId)) return true;
  // Claude Opus 4.7 and up (claude-opus-4-7 / -8 / -9) also reject temperature
  // on Bedrock, even though they're a 4-generation id.
  if (/claude-opus-4-[7-9]/i.test(modelId)) return true;
  return false;
}

function stripTemperature(
  cfg: InferenceConfiguration | undefined,
): InferenceConfiguration | undefined {
  if (!cfg) return cfg;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { temperature, ...rest } = cfg;
  return rest;
}

/**
 * Sends a Converse request, transparently handling models that reject the
 * `temperature` parameter. For models known to reject it we drop temperature up
 * front (so the common case doesn't waste a guaranteed-failing call); as a
 * safety net for any other such model, a failure mentioning temperature is
 * retried once without it.
 */
export async function sendConverse(
  client: BedrockRuntimeClient,
  input: ConverseCommandInput,
): Promise<ConverseCommandOutput> {
  const effective: ConverseCommandInput =
    input.modelId &&
    modelRejectsTemperature(input.modelId) &&
    input.inferenceConfig?.temperature !== undefined
      ? { ...input, inferenceConfig: stripTemperature(input.inferenceConfig) }
      : input;
  try {
    return await client.send(new ConverseCommand(effective));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /temperature/i.test(msg) &&
      effective.inferenceConfig?.temperature !== undefined
    ) {
      return await client.send(
        new ConverseCommand({
          ...effective,
          inferenceConfig: stripTemperature(effective.inferenceConfig),
        }),
      );
    }
    throw err;
  }
}
