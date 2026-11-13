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
export type AiInput = unknown;

/**
 * A step retry strategy.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type AiRetryStrategy = (
  error: Error,
  attemptCount: number,
) => RetryDecision;

/**
 * Options of one call.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AiCallOptions {
  /**
   * The step name. The default is `decider.<operation>` or `llm.ask`. Replay
   * compares the name with the checkpoint. So adding or changing a name on an
   * existing call breaks executions in flight.
   */
  name?: string;
}

// ---------------------------------------------------------------- decider

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
 * Sends one request to a decision model and returns its JSON reply.
 * `agentCoreTransport`, `sageMakerTransport`, and `lambdaTransport` return
 * one. Write your own to reach a model another way.
 *
 * @remarks
 * A transport must stop and reject when `abortSignal` aborts. The signal
 * aborts 10 seconds before the invocation runs out of time, and when the SDK
 * cancels the step. The SDK cannot stop a promise that ignores the signal. So
 * a transport that ignores it can run past the 10-second reserve, and the
 * invocation can time out before the step records its outcome.
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
 * The part of an AWS SDK client that the decider transports use: its `send`
 * method. Pass a fake in a test, or your own client to set a Region.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * A Strands Decider deployed on Amazon Bedrock AgentCore Runtime.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentCoreConfig {
  /** The ARN of the AgentCore Runtime that serves the model. */
  runtimeArn: string;
  /** The runtime endpoint name. The default is the runtime's default endpoint. */
  qualifier?: string;
  /** A `BedrockAgentCoreClient`. The default client uses the function's Region and credentials. */
  client?: AwsSdkClient;
}

/**
 * A Strands Decider deployed on an Amazon SageMaker real-time endpoint.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface SageMakerConfig {
  /** The name of the SageMaker endpoint that serves the model. */
  endpointName: string;
  /** A `SageMakerRuntimeClient`. The default client uses the function's Region and credentials. */
  client?: AwsSdkClient;
}

/**
 * A Strands Decider deployed as an AWS Lambda function.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface LambdaConfig {
  /** The name or ARN of the function that serves the model. */
  functionName: string;
  /** The version or alias to invoke, such as `live`. The default is `$LATEST`. */
  qualifier?: string;
  /** A `LambdaClient`. The default client uses the function's Region and credentials. */
  client?: AwsSdkClient;
}

/**
 * The configuration of {@link decider}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DeciderConfig {
  /**
   * The full URL of the model's `POST /v1/systemone` route, such as
   * `http://127.0.0.1:8000/v1/systemone`. The default is the
   * `STRANDS_DECIDER_ENDPOINT` environment variable. It must not contain a
   * user name or password: pass credentials in `headers`.
   */
  endpoint?: string;
  /** Extra HTTP headers for `endpoint`, such as an authorization header. */
  headers?: Record<string, string>;
  /** The value of the request's `model` field. The default is `strands-decider-latest`. */
  model?: string;
  /**
   * The function that sends the request, such as one that
   * `agentCoreTransport`, `sageMakerTransport`, or `lambdaTransport` returns.
   * Do not combine it with `endpoint`.
   */
  transport?: DeciderTransport;
  /**
   * The probability at or above which `check` and `label` answer yes. From 0
   * to 1. The default is 0.5.
   */
  threshold?: number;
  /** The step retry strategy. The default is {@link defaultAiRetryStrategy}. */
  retryStrategy?: AiRetryStrategy;
}

/**
 * The four operations that {@link decider} returns. Each one is one durable
 * step, and each one takes the context first.
 *
 * @remarks
 * Every operation has these limits:
 *
 * - `question` must be a non-empty string.
 * - `input` must be a string or a value that `JSON.stringify` can encode.
 * - The decision model reads the input and each question, with its choices,
 *   in one context window: 4,096 tokens for Strands Decider 2B. A request
 *   that does not fit fails with `DeciderError` and HTTP 422, which is not
 *   retried. Shorten the input before the call.
 * - An invalid argument creates no durable operation. The returned promise
 *   rejects with a `TypeError` or a `RangeError`.
 * - A decision model that cannot be reached, or answers with HTTP 408, 429,
 *   or 5xx, fails the attempt with `DeciderError`, and the step retries.
 *   Another 3xx or 4xx is not retried, and redirects are not followed.
 * - A request still running 10 seconds before the invocation runs out of
 *   time stops with `AiTimeoutError`, and the step retries in a new
 *   invocation.
 * - The answer is the step result, so a replay returns it without calling the
 *   model.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface Decider {
  /**
   * Answers a yes-or-no question.
   *
   * @remarks
   * Limits:
   *
   * - Phrase the question so that yes is `true`.
   * - The answer is `true` when the model's probability of yes is at least
   *   `threshold`, 0.5 by default.
   *
   * @param context - The context to create the step in.
   * @param question - A yes-or-no question.
   * @param input - The text or data that the question is about.
   * @param options - The step name.
   */
  check(
    context: DurableContext,
    question: string,
    input: AiInput,
    options?: AiCallOptions,
  ): DurablePromise<boolean>;

  /**
   * Returns exactly one of the choices, in the caller's spelling. TypeScript
   * types the result as the union of the choices.
   *
   * @remarks
   * Limits:
   *
   * - 2 to {@link MAX_CLASSIFY_OPTIONS} choices.
   * - Every choice is a non-empty string.
   * - The choices must differ after trimming whitespace and ignoring case.
   * - The model always picks a choice. Add a choice such as `"other"` when
   *   none may fit.
   * - Every choice counts toward the model's context window.
   *
   * @param context - The context to create the step in.
   * @param question - The question that the choices answer.
   * @param choices - The possible answers.
   * @param input - The text or data that the question is about.
   * @param options - The step name.
   */
  classify<const T extends readonly string[]>(
    context: DurableContext,
    question: string,
    choices: T,
    input: AiInput,
    options?: AiCallOptions,
  ): DurablePromise<T[number]>;

  /**
   * Returns every choice that applies, in the order of `choices`. The result
   * can be empty.
   *
   * @remarks
   * Limits:
   *
   * - At least 2 choices.
   * - Every choice is a non-empty string.
   * - The choices must differ after trimming whitespace and ignoring case.
   * - Each choice is one yes-or-no question to the decision model. The model
   *   reads the input once, but each choice adds time. So keep the list
   *   short.
   * - A choice applies when the model's probability of yes is at least
   *   `threshold`, 0.5 by default.
   *
   * @param context - The context to create the step in.
   * @param question - The question that the choices answer.
   * @param choices - The labels to test.
   * @param input - The text or data that the question is about.
   * @param options - The step name.
   */
  label<const T extends readonly string[]>(
    context: DurableContext,
    question: string,
    choices: T,
    input: AiInput,
    options?: AiCallOptions,
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
    scale: readonly string[],
    input: AiInput,
    options?: AiCallOptions,
  ): DurablePromise<number>;
}

// ---------------------------------------------------------------- llm

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
 * Settings for a model on Amazon Bedrock, called through the Converse API.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface BedrockConfig {
  /**
   * The model ID or inference profile ID. The default is
   * {@link DEFAULT_LLM_MODEL_ID}. The model must be available in the
   * function's Region and account.
   */
  modelId?: string;
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
 * The configuration of {@link llm}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface LlmConfig {
  /**
   * Where the model runs. It holds exactly one key. This release supports
   * `bedrock` only. The default is {@link DEFAULT_LLM_MODEL_ID} on Bedrock.
   */
  destination?: { bedrock: BedrockConfig };
  /** The step retry strategy. The default is {@link defaultAiRetryStrategy}. */
  retryStrategy?: AiRetryStrategy;
}

/**
 * Options of one `ask` call.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface LlmCallOptions extends AiCallOptions {
  /** Overrides settings of the Bedrock model for this call. */
  bedrock?: Pick<BedrockConfig, "modelId" | "temperature" | "maxTokens">;
}

/**
 * The operation that {@link llm} returns.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface Llm {
  /**
   * Returns the model's reply as text, in one durable step.
   *
   * @remarks
   * Limits:
   *
   * - `question` must be a non-empty string.
   * - `input` is optional. It must be a string or a value that
   *   `JSON.stringify` can encode.
   * - The function's role needs `bedrock:InvokeModel` on the model, and on
   *   the inference profile when the model ID names one.
   * - The reply is at most `maxTokens` tokens, 1024 by default. A reply that
   *   reaches the limit fails the step with `LlmMaxTokensError` and is not
   *   retried. Raise `maxTokens` instead.
   * - A reply that stops for another reason, such as a guardrail that
   *   intervened, fails the step with `LlmStoppedError`. Only
   *   `malformed_model_output` and `malformed_tool_use` are retried.
   * - A request still running 10 seconds before the invocation runs out of
   *   time stops with `AiTimeoutError`, and the step retries in a new
   *   invocation.
   * - The reply is checkpointed, so it must fit the 256 KB checkpoint limit.
   * - An invalid argument creates no durable operation. The returned promise
   *   rejects with a `TypeError`.
   *
   * @param context - The context to create the step in.
   * @param question - The instruction to the model.
   * @param input - The text or data that the question is about.
   * @param options - The step name and per-call model settings.
   */
  ask(
    context: DurableContext,
    question: string,
    input?: AiInput,
    options?: LlmCallOptions,
  ): DurablePromise<string>;
}
