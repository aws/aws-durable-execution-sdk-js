import type {
  DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import { parseReply } from "./aws-sdk";
import { DeciderError } from "./errors";
import {
  aiStep,
  causeChain,
  invalid,
  matchOption,
  serializeInput,
  toUnitScore,
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

/** The cause's type, and the first system error code in its chain. */
function reason(cause: unknown): string {
  const name = (cause as { name?: unknown } | null)?.name;
  const code = causeChain(cause)
    .map((link) => (link as { code?: unknown } | null)?.code)
    .find(
      (value): value is string =>
        typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value),
    );
  return [typeof name === "string" ? name : "Error", code]
    .filter(Boolean)
    .join(", ");
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
        // The cause's own message can repeat the full URL, and only the
        // message is checkpointed. So the message names the cause's type and
        // its system error code, such as ECONNREFUSED, which hold no URL.
        `The decision model at ${where} could not be reached (${reason(cause)}).`,
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
    // The body is read first and parsed second. A read that fails, for
    // example when the connection drops after the headers, is a transport
    // failure. Only a body that is not JSON is an invalid reply.
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw new DeciderError(
        `The decision model at ${where} answered HTTP ${response.status}, but its reply could not be read (${reason(cause)}).`,
        { cause },
      );
    }
    return parseReply(text);
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

/**
 * Returns the model's probability of yes, from 0 to 1. A value within
 * {@link SCORE_TOLERANCE} outside that range is rounding, and is clamped. A
 * value farther out is an invalid reply. Otherwise a reply such as 7 or -3
 * would be checkpointed as a confident answer.
 */
function probability(answer: Record<string, unknown> | undefined): number {
  const value = numberField(answer, "noul", "noul");
  if (value < -SCORE_TOLERANCE || value > 1 + SCORE_TOLERANCE) {
    return invalid(
      `The decision model's probability ${value} is outside 0 to 1.`,
    );
  }
  return Math.min(1, Math.max(0, value));
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
 * question and returns a typed answer.
 *
 * @remarks
 * A decision model, such as Strands Decider, is not a large language model.
 * It does not write text. It picks one of the caller's options or rates on a
 * scale. So its answer is always one of the options, or a number in range.
 *
 * The model is a Strands Decider that you deployed. Every host takes the
 * same request. Name the model one of two ways:
 *
 * 1. `endpoint`: the URL of its `POST /v1/systemone` route. The default is
 *    the `STRANDS_DECIDER_ENDPOINT` environment variable.
 * 2. `transport`: the function that sends the request. Use
 *    `agentCoreTransport`, `sageMakerTransport`, or `lambdaTransport` for a
 *    model on AWS. They sign the call with the function's credentials. Write
 *    your own transport for any other host.
 *
 * When both are set, `transport` is used, and `endpoint` and `headers` are
 * ignored.
 *
 * This package does not host or check the model. It assumes the model is
 * deployed and ready.
 *
 * The step result is the answer. A replay returns it from the checkpoint and
 * does not call the model. The operations do not check their arguments. A
 * failed call rejects with the error of the step's last attempt. The step
 * retries with the core SDK's default strategy, or with `retryStrategy` when
 * it is set.
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
 * @throws \{TypeError\} When the config names no `transport` or `endpoint`
 * and `STRANDS_DECIDER_ENDPOINT` is not set, or when the endpoint is not an
 * absolute `http:` or `https:` URL or contains a user name or password.
 * `decider()` usually runs when the module loads, so the function then fails
 * to initialize.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function decider(config: DeciderConfig = {}): Decider {
  // A transport wins over an endpoint. The endpoint and headers are then not
  // used.
  const endpoint = config.endpoint ?? process.env.STRANDS_DECIDER_ENDPOINT;
  const transport =
    config.transport ??
    (endpoint
      ? httpTransport(parseEndpoint(endpoint), config.headers)
      : undefined);
  // Without a transport, no call can reach a model. So decider() fails here,
  // when the module loads, and not at the first call.
  if (!transport) {
    throw new TypeError(
      "decider() needs a transport, an endpoint, or the STRANDS_DECIDER_ENDPOINT environment variable.",
    );
  }
  const send: DeciderTransport = transport;
  const model = config.model ?? DEFAULT_DECIDER_MODEL;
  const yesAt = config.threshold ?? 0.5;

  /**
   * Runs one operation in one step. The input is serialized inside the step,
   * once per attempt.
   */
  function run<T>(
    context: DurableContext,
    operation: Operation,
    input: unknown,
    options: AiCallOptions | undefined,
    questions: () => Record<string, unknown>,
    answer: (answers: Answers) => T,
  ): DurablePromise<T> {
    return aiStep(
      context,
      options?.name ?? `decider.${operation}`,
      { retryStrategy: config.retryStrategy, subType: SUBTYPES[operation] },
      async (signal) => {
        const request: DeciderRequest = {
          model,
          state: serializeInput(input),
          questions: questions(),
        };
        const response = await send(request, { abortSignal: signal });
        return answer(answersOf(response));
      },
    );
  }

  return {
    check(context, question, input, options) {
      return run(
        context,
        "check",
        input,
        options,
        () => ({ [ANSWER]: { type: "noul", instructions: question } }),
        (answers) => probability(answers[ANSWER]) >= yesAt,
      );
    },

    classify<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: AiCallOptions,
    ) {
      return run<T[number]>(
        context,
        "classify",
        input,
        options,
        () => ({
          [ANSWER]: {
            type: "choice",
            instructions: question,
            criteria: Object.fromEntries(
              choices.map((option) => [option, null]),
            ),
          },
        }),
        (answers) => {
          const answer = answers[ANSWER];
          if (answer?.type !== "choice") {
            return invalid("The decision model's answer is not a choice.");
          }
          // A choice that is not a string is never coerced to a string,
          // because String() can throw on such a value.
          if (typeof answer.choice !== "string") {
            return invalid("The decision model's choice is not a string.");
          }
          return (matchOption(choices, answer.choice) ??
            invalid(
              `"${answer.choice}" is not one of the options.`,
            )) as T[number];
        },
      );
    },

    label<const T extends readonly string[]>(
      context: DurableContext,
      question: string,
      choices: T,
      input: unknown,
      options?: AiCallOptions,
    ) {
      return run<T[number][]>(
        context,
        "label",
        input,
        options,
        // One yes-or-no question per option. The model reads the input once.
        () =>
          Object.fromEntries(
            choices.map((option, i) => [
              `o${i}`,
              {
                type: "noul",
                instructions: `${question}\nDoes this label apply: ${option}`,
              },
            ]),
          ),
        (answers) =>
          choices.filter(
            (_option, i) => probability(answers[`o${i}`]) >= yesAt,
          ),
      );
    },

    score(context, question, scale, input, options) {
      return run(
        context,
        "score",
        input,
        options,
        () => ({
          [ANSWER]: { type: "score", instructions: question, criteria: scale },
        }),
        (answers) => {
          // The model's score is the expected level index, from 0 to
          // levels - 1.
          const position = numberField(answers[ANSWER], "score", "score");
          const last = scale.length - 1;
          if (
            position < -SCORE_TOLERANCE ||
            position > last + SCORE_TOLERANCE
          ) {
            return invalid(
              `The decision model's score ${position} is outside 0 to ${last}.`,
            );
          }
          return toUnitScore(position, scale.length);
        },
      );
    },
  };
}
