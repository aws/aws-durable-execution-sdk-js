import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { BedrockConverse, DEFAULT_LLM_MODEL_ID } from "./bedrock";
import { defaultAiRetryStrategy } from "./retry";
import {
  aiStep,
  rejected,
  serializeInput,
  validateQuestion,
  validateStepName,
} from "./shared";
import { AiOperationSubType } from "./subtypes";
import type { BedrockConfig, Llm, LlmConfig } from "./types";

function onlyKey(destination: unknown, key: string): unknown {
  const keys =
    typeof destination === "object" && destination !== null
      ? Object.keys(destination)
      : [];
  if (keys.length !== 1 || keys[0] !== key) {
    throw new TypeError(`destination must have exactly one key, "${key}".`);
  }
  return (destination as Record<string, unknown>)[key];
}

/**
 * Creates the `ask` operation of a large language model. Each call is one
 * durable step that asks the model one question and returns its reply as
 * text. {@link Llm} lists the limits.
 *
 * @remarks
 * The model runs on Amazon Bedrock. The default is
 * {@link DEFAULT_LLM_MODEL_ID}. Use {@link decider} instead for a yes-or-no
 * answer, one or more of a list of options, or a rating: a decision model is
 * faster, and its answer is always one of the options.
 *
 * The step result is the reply. A replay returns it from the checkpoint and
 * does not call the model.
 *
 * ```typescript
 * const model = llm();
 * export const handler = withDurableExecution(async (ticket, context) =>
 *   model.ask(context, "Summarize this ticket in one sentence.", ticket.body),
 * );
 * ```
 *
 * @param config - The model. Every field has a default.
 * @throws \{TypeError\} When `destination` does not have exactly one key,
 * `bedrock`.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function llm(config: LlmConfig = {}): Llm {
  const bedrockConfig: BedrockConfig = config.destination
    ? (onlyKey(config.destination, "bedrock") as BedrockConfig)
    : { modelId: DEFAULT_LLM_MODEL_ID };
  const bedrock = new BedrockConverse(bedrockConfig);
  const retryStrategy = config.retryStrategy ?? defaultAiRetryStrategy;

  return {
    ask(context: DurableContext, question, input, options) {
      // The input is serialized once, here, so a toJSON hook runs once and
      // the model gets the value that was checked.
      let text: string | undefined;
      try {
        validateQuestion(question);
        validateStepName(options?.name);
        text = input === undefined ? undefined : serializeInput(input);
      } catch (error) {
        return rejected(error);
      }
      return aiStep(
        context,
        options?.name ?? "llm.ask",
        { retryStrategy, subType: AiOperationSubType.LLM_ASK },
        (signals) => bedrock.ask(question, text, options?.bedrock, signals),
      );
    },
  };
}
