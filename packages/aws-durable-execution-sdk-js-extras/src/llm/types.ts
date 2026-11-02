import type {
  DurableContext,
  DurablePromise,
  RetryDecision,
} from "@aws/durable-execution-sdk-js";

/**
 * The input of an operation: a string, or a JSON-serializable value. The
 * operation serializes a non-string input with `JSON.stringify`. A value that
 * `JSON.stringify` cannot encode, such as a `BigInt` or a circular object,
 * rejects the call with a `TypeError`.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type LlmInput = unknown;

/**
 * The part of `BedrockRuntimeClient` that `ask` uses. Pass a fake in a test.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface BedrockConverseClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * Settings for the Amazon Bedrock text model that `ask` calls through the
 * Converse API.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface BedrockConfig {
  /**
   * The model ID or inference profile ID. The default is
   * {@link DEFAULT_GENERATE_MODEL_ID}. The model must be available in the
   * function's Region and account.
   */
  modelId: string;
  /** A `BedrockRuntimeClient`. The default client uses the function's Region and credentials. */
  client?: BedrockConverseClient;
  /**
   * The sampling temperature. It is sent only when set, because some newer
   * models, such as Claude Haiku 5.5, reject it.
   */
  temperature?: number;
  /** The reply limit in tokens. The default is 1024. */
  maxTokens?: number;
  /** Extra instructions that `ask` appends to its own system prompt. */
  system?: string;
  /** A guardrail that `ask` passes to Converse. */
  guardrail?: { identifier: string; version: string };
}

/**
 * A request to a decision model, in the format of its `POST /v1/systemone`
 * route.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DeciderRequest {
  model: string;
  state: unknown;
  questions: Record<string, unknown>;
}

/**
 * Sends one request to a decision model and returns its JSON reply. Use it to
 * reach a model with SigV4, such as a SageMaker endpoint.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type DeciderTransport = (
  request: DeciderRequest,
  options: { abortSignal?: AbortSignal },
) => Promise<unknown>;

/**
 * Settings for a decision model, such as Strands Decider. A decision model
 * does not write text. It picks an option or rates on a scale.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DeciderConfig {
  /**
   * The full URL of the model's `POST /v1/systemone` route, such as
   * `http://127.0.0.1:8000/v1/systemone`. The `STRANDS_DECIDER_ENDPOINT`
   * environment variable sets the default.
   */
  endpoint?: string;
  /** Extra HTTP headers, such as an authorization header. */
  headers?: Record<string, string>;
  /** The value of the request's `model` field. The default is `strands-decider-latest`. */
  model?: string;
  /** Replaces the HTTP request. `endpoint` and `headers` do not apply then. */
  transport?: DeciderTransport;
}

/**
 * The model for `check`, `classify`, `label`, and `score`.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DecideConfig {
  destination: { decider: DeciderConfig };
  /**
   * The probability at or above which `check` and `label` answer yes. The
   * default is 0.5.
   */
  threshold?: number;
}

/**
 * The model for `ask`.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface GenerateConfig {
  destination: { bedrock: BedrockConfig };
}

/**
 * The configuration of {@link llm}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface LlmConfig {
  /**
   * The decision model for `check`, `classify`, `label`, and `score`. The
   * default is a Strands Decider at the URL in the `STRANDS_DECIDER_ENDPOINT`
   * environment variable. Without either, those four operations reject with a
   * `TypeError`, and only `ask` works.
   */
  decide?: DecideConfig;
  /**
   * The text model for `ask`. The default is
   * {@link DEFAULT_GENERATE_MODEL_ID} on Amazon Bedrock.
   */
  generate?: GenerateConfig;
  /**
   * The step retry strategy. The default is {@link defaultLlmRetryStrategy}.
   */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
}

/**
 * Options of one call.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface LlmCallOptions {
  /**
   * The step name. The default is `llm.<operation>`, such as `llm.check`.
   * Replay compares the name with the checkpoint. So adding or changing a name
   * on an existing call breaks executions in flight.
   */
  name?: string;
  /** Overrides settings of the Bedrock text model for this call. Only `ask` reads it. */
  bedrock?: Pick<BedrockConfig, "modelId" | "temperature" | "maxTokens">;
}

/**
 * The five operations that {@link llm} returns. Each one is one durable step,
 * and each one takes the context first.
 *
 * @remarks
 * Every operation has these limits:
 *
 * - `question` must be a non-empty string.
 * - `input` must be a string or a value that `JSON.stringify` can encode.
 * - An invalid argument creates no durable operation. The returned promise
 *   rejects with a `TypeError` or a `RangeError`.
 * - The answer is the step result, so a replay returns it without calling a
 *   model.
 *
 * `check`, `classify`, `label`, and `score` also have these limits:
 *
 * - They need a decision model: `decide` in the config, or the
 *   `STRANDS_DECIDER_ENDPOINT` environment variable. Without one, they reject
 *   with a `TypeError`.
 * - The decision model reads the question, the options, and the input in one
 *   context window. Strands Decider 2B has 4,096 tokens. The server cuts a
 *   longer input to fit and keeps the question and the options. So put the
 *   part of the input that decides the answer first.
 * - A decision model that cannot be reached, or answers with HTTP 408, 429,
 *   or 5xx, fails the attempt with `LlmDeciderError`, and the step retries. A
 *   4xx answer is not retried.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface Llm {
  /**
   * Returns the text model's reply.
   *
   * @remarks
   * Limits:
   *
   * - The text model is {@link DEFAULT_GENERATE_MODEL_ID} unless `generate`
   *   names another. The function's role needs `bedrock:InvokeModel` on it.
   * - `input` is optional, because some questions need none.
   * - The reply is at most `maxTokens` tokens, 1024 by default. A reply that
   *   reaches the limit fails the step with `LlmError` and is not retried.
   *   Raise `maxTokens` instead.
   * - The reply is checkpointed, so it must fit the 256 KB checkpoint limit.
   *
   * @param context - The context to create the step in.
   * @param question - The instruction to the model.
   * @param input - The text or data that the question is about.
   * @param options - The step name and per-call model settings.
   */
  ask(
    context: DurableContext,
    question: string,
    input?: LlmInput,
    options?: LlmCallOptions,
  ): DurablePromise<string>;

  /**
   * Answers a yes-or-no question.
   *
   * @remarks
   * Limits:
   *
   * - Phrase the question so that yes is `true`.
   * - The answer is `true` when the model's probability of yes is at least
   *   `decide.threshold`, 0.5 by default.
   *
   * @param context - The context to create the step in.
   * @param question - A yes-or-no question.
   * @param input - The text or data that the question is about.
   * @param options - The step name.
   */
  check(
    context: DurableContext,
    question: string,
    input: LlmInput,
    options?: LlmCallOptions,
  ): DurablePromise<boolean>;

  /**
   * Returns exactly one of the options, in the caller's spelling. TypeScript
   * types the result as the union of the options.
   *
   * @remarks
   * Limits:
   *
   * - 2 to {@link MAX_CLASSIFY_OPTIONS} options.
   * - Every option is a non-empty string.
   * - The options must differ after trimming whitespace and ignoring case.
   * - The model always picks an option. Add an option such as `"other"` when
   *   none may fit.
   *
   * @param context - The context to create the step in.
   * @param question - The question that the options answer.
   * @param options - The possible answers.
   * @param input - The text or data that the question is about.
   * @param callOptions - The step name.
   */
  classify<const T extends readonly string[]>(
    context: DurableContext,
    question: string,
    options: T,
    input: LlmInput,
    callOptions?: LlmCallOptions,
  ): DurablePromise<T[number]>;

  /**
   * Returns every option that applies, in the order of `options`. The result
   * can be empty.
   *
   * @remarks
   * Limits:
   *
   * - At least 2 options.
   * - Every option is a non-empty string.
   * - The options must differ after trimming whitespace and ignoring case.
   * - Each option is one yes-or-no question to the decision model. The model
   *   reads the input once, but each option adds time. So keep the list
   *   short.
   * - An option applies when the model's probability of yes is at least
   *   `decide.threshold`, 0.5 by default.
   *
   * @param context - The context to create the step in.
   * @param question - The question that the options answer.
   * @param options - The labels to test.
   * @param input - The text or data that the question is about.
   * @param callOptions - The step name.
   */
  label<const T extends readonly string[]>(
    context: DurableContext,
    question: string,
    options: T,
    input: LlmInput,
    callOptions?: LlmCallOptions,
  ): DurablePromise<T[number][]>;

  /**
   * Returns a number from 0 to 1. The first entry of `scale` is 0, the last
   * entry is 1, and the entries between them are evenly spaced. The number can
   * fall between two entries.
   *
   * @remarks
   * Limits:
   *
   * - 2 to {@link MAX_SCORE_LEVELS} entries.
   * - Every entry is a non-empty string.
   * - Order the entries from lowest to highest.
   *
   * @param context - The context to create the step in.
   * @param question - The question that the scale answers.
   * @param scale - The scale, from lowest to highest.
   * @param input - The text or data that the question is about.
   * @param options - The step name.
   */
  score(
    context: DurableContext,
    question: string,
    scale: readonly [string, string, ...string[]],
    input: LlmInput,
    options?: LlmCallOptions,
  ): DurablePromise<number>;
}
