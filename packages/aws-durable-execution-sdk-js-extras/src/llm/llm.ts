import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import {
  deadlineSignal,
  MAX_CLASSIFY_OPTIONS,
  serializeInput,
  validateOptions,
  validateQuestion,
  validateScale,
} from "./shared";
import { Decider, DEFAULT_DECIDER_MODEL, resolveTransport } from "./decider";
import { BedrockGenerator, DEFAULT_GENERATE_MODEL_ID } from "./generate";
import { defaultLlmRetryStrategy } from "./retry";
import { LlmOperationSubType } from "./subtypes";
import type {
  BedrockConfig,
  DeciderConfig,
  Llm,
  LlmCallOptions,
  LlmConfig,
} from "./types";

type Operation = "ask" | "check" | "classify" | "label" | "score";

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
    return 0.5;
  }
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be a number from 0 to 1.`);
  }
  return value;
}

/**
 * Creates the five LLM operations: `ask`, `check`, `classify`, `label`, and
 * `score`. Each call is one durable step that asks one question and returns a
 * typed answer. {@link Llm} lists each operation's limits.
 *
 * @remarks
 * The operations use two kinds of model:
 *
 * 1. `check`, `classify`, `label`, and `score` use a decision model. A
 *    decision model does not write text. It picks an option or rates on a
 *    scale, so its answer is always one of the caller's options. The default
 *    is a Strands Decider at the URL in the `STRANDS_DECIDER_ENDPOINT`
 *    environment variable. This package does not host the model.
 * 2. `ask` uses a text model on Amazon Bedrock,
 *    {@link DEFAULT_GENERATE_MODEL_ID} unless `generate` names another.
 *
 * The step result is the answer. A replay returns it from the checkpoint and
 * does not call a model.
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
 * @param config - The models. Every field has a default.
 * @throws \{TypeError\} When a `destination` is not valid, or `decide` names
 * neither an endpoint, a transport, nor the `STRANDS_DECIDER_ENDPOINT`
 * environment variable.
 * @throws \{RangeError\} When `decide.threshold` is not between 0 and 1.
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
    decider = new Decider(
      transport,
      deciderConfig.model ?? DEFAULT_DECIDER_MODEL,
      unitInterval(decideConfig.threshold, "threshold"),
    );
  }

  const retryStrategy = config.retryStrategy ?? defaultLlmRetryStrategy;

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

  /** Returns the decision model, or throws when none is configured. */
  function needDecider(operation: Operation): Decider {
    if (!decider) {
      throw new TypeError(
        `llm.${operation} needs a decision model. Set decide in the llm() config, or the STRANDS_DECIDER_ENDPOINT environment variable.`,
      );
    }
    return decider;
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
      let model: Decider;
      try {
        validateQuestion(question);
        serializeInput(input);
        model = needDecider("check");
      } catch (error) {
        return rejected(error);
      }
      return run(context, "check", options, (signal) =>
        model.check(question, input, signal),
      );
    },

    classify<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: LlmCallOptions,
    ) {
      let model: Decider;
      try {
        validateQuestion(question);
        validateOptions(choices, MAX_CLASSIFY_OPTIONS);
        serializeInput(input);
        model = needDecider("classify");
      } catch (error) {
        return rejected<T[number]>(error);
      }
      return run<T[number]>(
        context,
        "classify",
        options,
        async (signal) =>
          (await model.classify(question, choices, input, signal)) as T[number],
      );
    },

    label<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: LlmCallOptions,
    ) {
      let model: Decider;
      try {
        validateQuestion(question);
        validateOptions(choices);
        serializeInput(input);
        model = needDecider("label");
      } catch (error) {
        return rejected<T[number][]>(error);
      }
      return run<T[number][]>(
        context,
        "label",
        options,
        async (signal) =>
          (await model.label(question, choices, input, signal)) as T[number][],
      );
    },

    score(context, question, scale, input, options) {
      let model: Decider;
      try {
        validateQuestion(question);
        validateScale(scale);
        serializeInput(input);
        model = needDecider("score");
      } catch (error) {
        return rejected(error);
      }
      return run(context, "score", options, (signal) =>
        model.score(question, scale, input, signal),
      );
    },
  };
}
