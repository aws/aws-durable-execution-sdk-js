import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import { DeciderError } from "./errors";
import { defaultAiRetryStrategy } from "./retry";
import {
  deadlineError,
  deadlineSignal,
  invalid,
  MAX_CLASSIFY_OPTIONS,
  matchOption,
  rejected,
  serializeInput,
  toUnitScore,
  validateOptions,
  validateQuestion,
  validateScale,
} from "./shared";
import { AiOperationSubType } from "./subtypes";
import type {
  AiCallOptions,
  Decider,
  DeciderConfig,
  DeciderRequest,
  DeciderTransport,
} from "./types";

/** The `model` field of a request when the config sets none. */
export const DEFAULT_DECIDER_MODEL = "strands-decider-latest";

const ANSWER = "answer";

/** Rounding room for a score at either end of the scale. */
const SCORE_TOLERANCE = 0.01;

/**
 * Parses the endpoint URL.
 *
 * @throws \{TypeError\} When it is not an absolute `http:` or `https:` URL.
 */
function parseEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError(
      "The decider endpoint must be an absolute http: or https: URL.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(
      "The decider endpoint must be an absolute http: or https: URL.",
    );
  }
  if (url.username || url.password) {
    // fetch() refuses such a URL, and its error repeats the password.
    throw new TypeError(
      "The decider endpoint must not contain credentials. Pass them in headers instead.",
    );
  }
  return url;
}

function httpTransport(
  url: URL,
  headers: Record<string, string> | undefined,
): DeciderTransport {
  // Errors are checkpointed. So they name the endpoint without its query,
  // fragment, or credentials, which can hold a secret.
  const where = `${url.origin}${url.pathname}`;
  return async (request, { abortSignal }) => {
    let response: Response;
    try {
      response = await fetch(url.href, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(request),
        signal: abortSignal,
        // A redirect would send the headers to another server.
        redirect: "manual",
      });
    } catch (cause) {
      throw new DeciderError(
        // The cause's own message can repeat the full URL. So the message
        // names only the cause's type, and the cause stays on the error.
        `The decision model at ${where} could not be reached (${(cause as Error).name}).`,
        { cause },
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw new DeciderError(
        `The decision model at ${where} answered HTTP ${response.status}. Redirects are not followed.`,
        { status: response.status },
      );
    }
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 200);
      throw new DeciderError(
        `The decision model at ${where} answered HTTP ${response.status}: ${body}`,
        { status: response.status },
      );
    }
    try {
      return await response.json();
    } catch (cause) {
      return invalid("The decision model's reply is not JSON.", cause);
    }
  };
}

type Answers = Record<string, Record<string, unknown> | undefined>;

function answersOf(response: unknown): Answers {
  const answers = (response as { answers?: unknown } | null)?.answers;
  if (typeof answers !== "object" || answers === null) {
    return invalid("The decision model's reply has no answers.");
  }
  return answers as Answers;
}

function numberField(
  answer: Record<string, unknown> | undefined,
  type: string,
  field: string,
): number {
  const value = answer?.[field];
  if (
    answer?.type !== type ||
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return invalid(`The decision model's "${field}" is not a number.`);
  }
  return value;
}

function threshold(value: number | undefined): number {
  if (value === undefined) {
    return 0.5;
  }
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) {
    throw new RangeError("threshold must be a number from 0 to 1.");
  }
  return value;
}

type Operation = "check" | "classify" | "label" | "score";

const SUBTYPES: Record<Operation, AiOperationSubType> = {
  check: AiOperationSubType.DECIDER_CHECK,
  classify: AiOperationSubType.DECIDER_CLASSIFY,
  label: AiOperationSubType.DECIDER_LABEL,
  score: AiOperationSubType.DECIDER_SCORE,
};

/**
 * Creates the four decision operations: `check`, `classify`, `label`, and
 * `score`. Each call is one durable step that asks a decision model one
 * question and returns a typed answer. {@link Decider} lists each operation's
 * limits.
 *
 * @remarks
 * A decision model, such as Strands Decider, is not a large language model.
 * It does not write text. It picks one of the caller's options or rates on a
 * scale. So its answer is always one of the options, or a number in range.
 *
 * The model must serve the `POST /v1/systemone` route of Strands Decider. The
 * default URL is the `STRANDS_DECIDER_ENDPOINT` environment variable. This
 * package does not host the model.
 *
 * The step result is the answer. A replay returns it from the checkpoint and
 * does not call the model.
 *
 * ```typescript
 * const decide = decider();
 * export const handler = withDurableExecution(async (ticket, context) => {
 *   if (await decide.check(context, "Is the customer asking for a human?", ticket.body)) {
 *     return escalate(ticket);
 *   }
 *   return decide.classify(context, "Which team?", ["returns", "billing"], ticket.body);
 * });
 * ```
 *
 * @param config - The decision model. Every field has a default.
 * @throws \{TypeError\} When the config names neither `endpoint` nor
 * `transport` and `STRANDS_DECIDER_ENDPOINT` is not set, or when the endpoint
 * is not an absolute `http:` or `https:` URL or contains a user name or
 * password. `decider()` usually
 * runs when the module loads, so the function then fails to initialize.
 * @throws \{RangeError\} When `threshold` is not between 0 and 1.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function decider(config: DeciderConfig = {}): Decider {
  const endpoint = config.endpoint ?? process.env.STRANDS_DECIDER_ENDPOINT;
  const transport =
    config.transport ??
    (endpoint
      ? httpTransport(parseEndpoint(endpoint), config.headers)
      : undefined);
  if (!transport) {
    throw new TypeError(
      "decider() needs an endpoint, a transport, or the STRANDS_DECIDER_ENDPOINT environment variable.",
    );
  }
  const send: DeciderTransport = transport;
  const model = config.model ?? DEFAULT_DECIDER_MODEL;
  const yesAt = threshold(config.threshold);
  const retryStrategy = config.retryStrategy ?? defaultAiRetryStrategy;

  async function ask(
    input: unknown,
    questions: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Answers> {
    const request: DeciderRequest = {
      model,
      state: serializeInput(input),
      questions,
    };
    let response: unknown;
    try {
      response = await send(request, { abortSignal: signal });
    } catch (error) {
      throw deadlineError(error, signal);
    }
    return answersOf(response);
  }

  function run<T>(
    context: DurableContext,
    operation: Operation,
    options: AiCallOptions | undefined,
    body: (signal: AbortSignal | undefined) => Promise<T>,
  ): DurablePromise<T> {
    return context.step(
      options?.name ?? `decider.${operation}`,
      async () => body(deadlineSignal(context)),
      { retryStrategy, subType: SUBTYPES[operation] },
    ) as DurablePromise<T>;
  }

  return {
    check(context, question, input, options) {
      try {
        validateQuestion(question);
        serializeInput(input);
      } catch (error) {
        return rejected(error);
      }
      return run(context, "check", options, async (signal) => {
        const answers = await ask(
          input,
          { [ANSWER]: { type: "noul", instructions: question } },
          signal,
        );
        return numberField(answers[ANSWER], "noul", "noul") >= yesAt;
      });
    },

    classify<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: AiCallOptions,
    ) {
      try {
        validateQuestion(question);
        validateOptions(choices, MAX_CLASSIFY_OPTIONS);
        serializeInput(input);
      } catch (error) {
        return rejected<T[number]>(error);
      }
      return run<T[number]>(context, "classify", options, async (signal) => {
        const criteria = Object.fromEntries(
          choices.map((option) => [option, null]),
        );
        const answers = await ask(
          input,
          { [ANSWER]: { type: "choice", instructions: question, criteria } },
          signal,
        );
        const answer = answers[ANSWER];
        if (answer?.type !== "choice") {
          return invalid("The decision model's answer is not a choice.");
        }
        return (matchOption(choices, answer.choice) ??
          invalid(
            `"${String(answer.choice)}" is not one of the options.`,
          )) as T[number];
      });
    },

    label<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: AiCallOptions,
    ) {
      try {
        validateQuestion(question);
        validateOptions(choices);
        serializeInput(input);
      } catch (error) {
        return rejected<T[number][]>(error);
      }
      return run<T[number][]>(context, "label", options, async (signal) => {
        // One yes-or-no question per option. The model reads the input once.
        const questions = Object.fromEntries(
          choices.map((option, i) => [
            `o${i}`,
            {
              type: "noul",
              instructions: `${question}\nDoes this label apply: ${option}`,
            },
          ]),
        );
        const answers = await ask(input, questions, signal);
        return choices.filter(
          (_option, i) =>
            numberField(answers[`o${i}`], "noul", "noul") >= yesAt,
        );
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
        const answers = await ask(
          input,
          {
            [ANSWER]: {
              type: "score",
              instructions: question,
              criteria: scale,
            },
          },
          signal,
        );
        // The model's score is the expected level index, from 0 to levels - 1.
        const position = numberField(answers[ANSWER], "score", "score");
        const last = scale.length - 1;
        if (position < -SCORE_TOLERANCE || position > last + SCORE_TOLERANCE) {
          return invalid(
            `The decision model's score ${position} is outside 0 to ${last}.`,
          );
        }
        return toUnitScore(position, scale.length);
      });
    },
  };
}
