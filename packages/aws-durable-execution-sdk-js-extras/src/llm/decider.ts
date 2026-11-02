import { LlmDeciderError } from "./errors";
import { invalid, matchOption, serializeInput, toUnitScore } from "./shared";
import type { DeciderConfig, DeciderRequest, DeciderTransport } from "./types";

export const DEFAULT_DECIDER_MODEL = "strands-decider-latest";

/** An answer and how sure the model is, from 0 to 1. */
export interface Decision<T> {
  value: T;
  confidence: number;
}

const ANSWER = "answer";

function httpTransport(
  endpoint: string,
  headers: Record<string, string> | undefined,
): DeciderTransport {
  return async (request, { abortSignal }) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(request),
        signal: abortSignal,
      });
    } catch (cause) {
      throw new LlmDeciderError(
        `The decision model at ${endpoint} could not be reached: ${(cause as Error).message}`,
        { cause },
      );
    }
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 200);
      throw new LlmDeciderError(
        `The decision model answered HTTP ${response.status}: ${body}`,
        { status: response.status },
      );
    }
    return response.json();
  };
}

/**
 * Resolves the transport of a decision model, or `undefined` when the config
 * names neither a transport nor an endpoint.
 */
export function resolveTransport(
  config: DeciderConfig,
): DeciderTransport | undefined {
  if (config.transport) {
    return config.transport;
  }
  const endpoint = config.endpoint ?? process.env.STRANDS_DECIDER_ENDPOINT;
  return endpoint ? httpTransport(endpoint, config.headers) : undefined;
}

/** The confidence of a yes-or-no probability: 0 for a coin flip, 1 when certain. */
function yesNoConfidence(probability: number): number {
  return Math.abs(2 * probability - 1);
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

function confidenceField(answer: Record<string, unknown>): number {
  const value = answer.confidence;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : invalid("The decision model's confidence is not a number.");
}

/** Asks typed questions of a decision model. */
export class Decider {
  constructor(
    private readonly transport: DeciderTransport,
    private readonly model: string,
    private readonly threshold: number,
  ) {}

  private ask(
    input: unknown,
    questions: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const request: DeciderRequest = {
      model: this.model,
      state: serializeInput(input),
      questions,
    };
    return this.transport(request, { abortSignal: signal });
  }

  async check(
    question: string,
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Decision<boolean>> {
    const answers = answersOf(
      await this.ask(
        input,
        { [ANSWER]: { type: "noul", instructions: question } },
        signal,
      ),
    );
    const probability = numberField(answers[ANSWER], "noul", "noul");
    return {
      value: probability >= this.threshold,
      confidence: yesNoConfidence(probability),
    };
  }

  async classify(
    question: string,
    options: readonly string[],
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Decision<string>> {
    const criteria = Object.fromEntries(
      options.map((option) => [option, null]),
    );
    const answers = await this.ask(
      input,
      { [ANSWER]: { type: "choice", instructions: question, criteria } },
      signal,
    ).then(answersOf);
    const answer = answers[ANSWER];
    if (answer?.type !== "choice") {
      return invalid("The decision model's answer is not a choice.");
    }
    const choice =
      matchOption(options, answer.choice) ??
      invalid(`"${String(answer.choice)}" is not one of the options.`);
    return { value: choice, confidence: confidenceField(answer) };
  }

  async label(
    question: string,
    options: readonly string[],
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Decision<string[]>> {
    // One yes-or-no question per option. The model reads the input once.
    const questions = Object.fromEntries(
      options.map((option, i) => [
        `o${i}`,
        {
          type: "noul",
          instructions: `${question}\nDoes this label apply: ${option}`,
        },
      ]),
    );
    const answers = answersOf(await this.ask(input, questions, signal));
    const picked: string[] = [];
    let confidence = 1;
    options.forEach((option, i) => {
      const probability = numberField(answers[`o${i}`], "noul", "noul");
      confidence = Math.min(confidence, yesNoConfidence(probability));
      if (probability >= this.threshold) {
        picked.push(option);
      }
    });
    return { value: picked, confidence };
  }

  async score(
    question: string,
    scale: readonly string[],
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Decision<number>> {
    const answers = answersOf(
      await this.ask(
        input,
        {
          [ANSWER]: { type: "score", instructions: question, criteria: scale },
        },
        signal,
      ),
    );
    const answer = answers[ANSWER];
    // The model's score is the expected level index, from 0 to levels - 1.
    const position = numberField(answer, "score", "score");
    return {
      value: toUnitScore(position, scale.length),
      confidence: confidenceField(answer as Record<string, unknown>),
    };
  }
}
