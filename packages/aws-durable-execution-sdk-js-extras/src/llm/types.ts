import type {
  DurableContext,
  DurablePromise,
  RetryDecision,
} from "@aws/durable-execution-sdk-js";

/**
 * The input of an operation: a string, or a JSON-serializable value. The
 * operation serializes a non-string input with `JSON.stringify`.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type LlmInput = unknown;

/**
 * The part of `BedrockRuntimeClient` that the operations use. Pass a fake in
 * a test.
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
 * Settings for the Amazon Bedrock destination. The operations call the
 * Converse API.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface BedrockConfig {
  /**
   * The model ID or inference profile ID. `check`, `classify`, `label`, and
   * `score` use structured output when no decision model is configured, so
   * the model must support it.
   */
  modelId: string;
  /** A `BedrockRuntimeClient`. The default client uses the function's Region and credentials. */
  client?: BedrockConverseClient;
  /** The sampling temperature. The default is 0. */
  temperature?: number;
  /**
   * The reply limit. The default depends on the operation: 64 for `check`,
   * `classify`, and `score`, 512 for `label`, and 1024 for `ask`.
   */
  maxTokens?: number;
  /** Extra instructions that the operation appends to its own system prompt. */
  system?: string;
  /** A guardrail that the operation passes to Converse. */
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
 * does not write text. It picks an option or rates on a scale, and it reports
 * how sure it is.
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
   * A confidence from 0 to 1. An answer that is less sure goes to the
   * `generate` model instead. The confidence of a yes or no is
   * `|2p - 1|` for the probability `p`, so 0.5 is a coin flip and 1 is
   * certain. The default is 0, which accepts every answer.
   */
  unsureBelow?: number;
  /**
   * The probability at or above which `check` and `label` answer yes. The
   * default is 0.5.
   */
  threshold?: number;
}

/**
 * The model for `ask`. It also answers `check`, `classify`, `label`, and
 * `score` when no decision model is configured, and when the decision model
 * is unsure.
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
   * The decision model. The default is a Strands Decider at the endpoint in
   * the `STRANDS_DECIDER_ENDPOINT` environment variable. Without either,
   * `generate` answers all five operations.
   */
  decide?: DecideConfig;
  /**
   * The text model. The default is Claude Haiku 4.5 on Amazon Bedrock
   * (`global.anthropic.claude-haiku-4-5-20251001-v1:0`).
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
  /** The step name. The default is `llm.<operation>`, such as `llm.check`. */
  name?: string;
  /** Overrides settings of the Bedrock destination for this call. */
  bedrock?: Pick<BedrockConfig, "modelId" | "temperature" | "maxTokens">;
}

/**
 * The five operations that {@link llm} returns. Each one is one durable step,
 * and each one takes the context first.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface Llm {
  /** Returns the model's reply as text. Only the `generate` model can answer. */
  ask(
    context: DurableContext,
    question: string,
    input?: LlmInput,
    options?: LlmCallOptions,
  ): DurablePromise<string>;

  /** Answers a yes-or-no question. */
  check(
    context: DurableContext,
    question: string,
    input: LlmInput,
    options?: LlmCallOptions,
  ): DurablePromise<boolean>;

  /** Returns exactly one of the options. */
  classify<const T extends readonly string[]>(
    context: DurableContext,
    question: string,
    options: T,
    input: LlmInput,
    callOptions?: LlmCallOptions,
  ): DurablePromise<T[number]>;

  /** Returns every option that applies, in the order of `options`. */
  label<const T extends readonly string[]>(
    context: DurableContext,
    question: string,
    options: T,
    input: LlmInput,
    callOptions?: LlmCallOptions,
  ): DurablePromise<T[number][]>;

  /**
   * Returns a number from 0 to 1. The first entry of `scale` is 0, the last
   * entry is 1, and the entries between them are evenly spaced.
   */
  score(
    context: DurableContext,
    question: string,
    scale: readonly [string, string, ...string[]],
    input: LlmInput,
    options?: LlmCallOptions,
  ): DurablePromise<number>;
}
