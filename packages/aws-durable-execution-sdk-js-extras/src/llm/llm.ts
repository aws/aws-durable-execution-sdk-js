import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import {
  DECIDER_MAX_CHOICE_OPTIONS,
  DECIDER_MAX_SCORE_LEVELS,
  deadlineSignal,
  serializeInput,
  validateOptions,
  validateQuestion,
  validateScale,
} from "./shared";
import { Decider, DEFAULT_DECIDER_MODEL, type Decision } from "./decider";
import {
  BedrockGenerator,
  DEFAULT_GENERATE_MODEL_ID,
  type Operation,
} from "./generate";
import { defaultLlmRetryStrategy } from "./retry";
import { LlmOperationSubType } from "./subtypes";
import type {
  BedrockConfig,
  DeciderConfig,
  Llm,
  LlmCallOptions,
  LlmConfig,
} from "./types";
import { resolveTransport } from "./decider";

const SUBTYPES: Record<Operation, LlmOperationSubType> = {
  ask: LlmOperationSubType.ASK,
  check: LlmOperationSubType.CHECK,
  classify: LlmOperationSubType.CLASSIFY,
  label: LlmOperationSubType.LABEL,
  score: LlmOperationSubType.SCORE,
};

function onlyKey(destination: unknown, key: string, where: string): unknown {
  const keys =
    typeof destination === "object" && destination !== null
      ? Object.keys(destination)
      : [];
  if (keys.length !== 1 || keys[0] !== key) {
    throw new TypeError(
      `${where}.destination must have exactly one key, "${key}".`,
    );
  }
  return (destination as Record<string, unknown>)[key];
}

function unitInterval(value: number | undefined, name: string): number {
  if (value === undefined) {
    return -1;
  }
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be a number from 0 to 1.`);
  }
  return value;
}

/**
 * Creates the five LLM operations: `ask`, `check`, `classify`, `label`, and
 * `score`. Each call is one durable step that asks one question and returns a
 * typed answer.
 *
 * @remarks
 * The operations use two kinds of model:
 *
 * 1. `check`, `classify`, `label`, and `score` use a decision model, when one
 *    is configured. A decision model does not write text. It picks an option or
 *    rates on a scale, in milliseconds, and it reports how sure it is. Set
 *    `decide.unsureBelow` to send the less sure answers to the text model.
 * 2. `ask` uses a text model. It also answers the other four operations when
 *    no decision model is configured.
 *
 * The decision model is a Strands Decider at the URL in the
 * `STRANDS_DECIDER_ENDPOINT` environment variable, or at
 * `decide.destination.decider.endpoint`. The text model is Claude Haiku 4.5 on
 * Amazon Bedrock, unless `generate` names another.
 *
 * The step result is the validated answer. A replay returns it from the
 * checkpoint and does not call a model.
 *
 * ```typescript
 * const model = llm();
 * export const handler = withDurableExecution(async (ticket, context) => {
 *   if (await model.check(context, "Is the customer asking for a human?", ticket.body)) {
 *     return escalate(ticket);
 *   }
 *   return model.classify(context, "Which team?", ["returns", "billing"], ticket.body);
 * });
 * ```
 *
 * An invalid argument (an empty question, fewer than two options, a scale
 * with fewer than two entries) creates no durable operation. The returned
 * promise rejects with a `TypeError` or a `RangeError`, as `microvm` does.
 *
 * @param config - The models. Every field has a default.
 * @throws \{TypeError\} When a `destination` is not valid, or `decide` names
 * neither an endpoint, a transport, nor the `STRANDS_DECIDER_ENDPOINT`
 * environment variable.
 * @throws \{RangeError\} When `unsureBelow` or `threshold` is not between 0
 * and 1.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function llm(config: LlmConfig = {}): Llm {
  const bedrockConfig: BedrockConfig = config.generate
    ? (onlyKey(
        config.generate.destination,
        "bedrock",
        "generate",
      ) as BedrockConfig)
    : { modelId: DEFAULT_GENERATE_MODEL_ID };
  const generator = new BedrockGenerator(bedrockConfig);

  let decider: Decider | undefined;
  let unsureBelow = -1;
  const decideConfig =
    config.decide ??
    (process.env.STRANDS_DECIDER_ENDPOINT
      ? { destination: { decider: {} } }
      : undefined);
  if (decideConfig) {
    const deciderConfig = onlyKey(
      decideConfig.destination,
      "decider",
      "decide",
    ) as DeciderConfig;
    const transport = resolveTransport(deciderConfig);
    if (!transport) {
      throw new TypeError(
        "decide needs an endpoint, a transport, or the STRANDS_DECIDER_ENDPOINT environment variable.",
      );
    }
    unsureBelow = unitInterval(decideConfig.unsureBelow, "unsureBelow");
    const threshold = unitInterval(decideConfig.threshold, "threshold");
    decider = new Decider(
      transport,
      deciderConfig.model ?? DEFAULT_DECIDER_MODEL,
      threshold < 0 ? 0.5 : threshold,
    );
  }

  const retryStrategy = config.retryStrategy ?? defaultLlmRetryStrategy;

  /** A decision below `unsureBelow` goes to the text model. */
  const accept = <T>(decision: Decision<T>): boolean =>
    decision.confidence >= unsureBelow;

  function run<T>(
    context: DurableContext,
    operation: Operation,
    options: LlmCallOptions | undefined,
    body: (signal: AbortSignal | undefined) => Promise<T>,
  ): DurablePromise<T> {
    return context.step(
      options?.name ?? `llm.${operation}`,
      async () => body(deadlineSignal(context)),
      { retryStrategy, subType: SUBTYPES[operation] },
    ) as DurablePromise<T>;
  }

  function rejected<T>(error: unknown): DurablePromise<T> {
    return new DurablePromise<T>(() => Promise.reject(error));
  }

  return {
    ask(context, question, input, options) {
      try {
        validateQuestion(question);
        serializeInput(input);
      } catch (error) {
        return rejected(error);
      }
      return run(context, "ask", options, (signal) =>
        generator.ask(question, input, options?.bedrock, signal),
      );
    },

    check(context, question, input, options) {
      try {
        validateQuestion(question);
        serializeInput(input);
      } catch (error) {
        return rejected(error);
      }
      return run(context, "check", options, async (signal) => {
        if (decider) {
          const decision = await decider.check(question, input, signal);
          if (accept(decision)) {
            return decision.value;
          }
        }
        return generator.check(question, input, options?.bedrock, signal);
      });
    },

    classify<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: LlmCallOptions,
    ) {
      try {
        validateQuestion(question);
        validateOptions(choices);
        serializeInput(input);
      } catch (error) {
        return rejected<T[number]>(error);
      }
      return run<T[number]>(context, "classify", options, async (signal) => {
        if (decider && choices.length <= DECIDER_MAX_CHOICE_OPTIONS) {
          const decision = await decider.classify(
            question,
            choices,
            input,
            signal,
          );
          if (accept(decision)) {
            return decision.value as T[number];
          }
        }
        return (await generator.classify(
          question,
          choices,
          input,
          options?.bedrock,
          signal,
        )) as T[number];
      });
    },

    label<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: LlmCallOptions,
    ) {
      try {
        validateQuestion(question);
        validateOptions(choices);
        serializeInput(input);
      } catch (error) {
        return rejected<T[number][]>(error);
      }
      return run<T[number][]>(context, "label", options, async (signal) => {
        if (decider) {
          const decision = await decider.label(
            question,
            choices,
            input,
            signal,
          );
          if (accept(decision)) {
            return decision.value as T[number][];
          }
        }
        return (await generator.label(
          question,
          choices,
          input,
          options?.bedrock,
          signal,
        )) as T[number][];
      });
    },

    score(context, question, scale, input, options) {
      try {
        validateQuestion(question);
        validateScale(scale);
        serializeInput(input);
      } catch (error) {
        return rejected(error);
      }
      return run(context, "score", options, async (signal) => {
        if (decider && scale.length <= DECIDER_MAX_SCORE_LEVELS) {
          const decision = await decider.score(question, scale, input, signal);
          if (accept(decision)) {
            return decision.value;
          }
        }
        return generator.score(
          question,
          scale,
          input,
          options?.bedrock,
          signal,
        );
      });
    },
  };
}
