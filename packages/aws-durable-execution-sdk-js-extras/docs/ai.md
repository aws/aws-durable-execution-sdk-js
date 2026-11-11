# AI operations: reference

> **Experimental.** Every API in this subpath is experimental. It may change or be removed in a future release, without a major version bump.

The `ai` subpath has two factories. Each returns operations that ask a model one question in one durable step. A replay returns the checkpointed answer and does not call a model.

| Factory | Operations | Model |
|---|---|---|
| `decider()` | `check`, `classify`, `label`, `score` | A decision model, such as [Strands Decider](https://github.com/strands-labs/strands-decider) |
| `llm()` | `ask` | A large language model on Amazon Bedrock |

| Operation | Returns |
|---|---|
| `check(ctx, question, input)` | `boolean` |
| `classify(ctx, question, choices, input)` | One entry of `choices`, typed as their union |
| `label(ctx, question, choices, input)` | Every entry of `choices` that applies, in the order of `choices` |
| `score(ctx, question, scale, input)` | A number from 0 (first entry of `scale`) to 1 (last entry) |
| `ask(ctx, question, input?)` | `string` |

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { decider, llm } from "@aws/durable-execution-sdk-js-extras/ai";

const decide = decider();
const model = llm();

export const handler = withDurableExecution(async (ticket, context) => {
  if (await decide.check(context, "Is the customer asking for a human?", ticket.body)) {
    return escalate(ticket);
  }
  const team = await decide.classify(
    context,
    "Which team should handle this?",
    ["returns", "shipping", "billing"],
    ticket.body,
  );
  // team has the type "returns" | "shipping" | "billing".
  const summary = await model.ask(context, "Summarize in one sentence.", ticket.body);
  return route(team, summary);
});
```

The first argument is the context that the call runs in. Inside a child context or a `map` item, pass that context. Call the factories once, when the module loads.

## `decider()`

A decision model is not a large language model. It does not write text. It picks one of your options or rates on a scale, so its answer is always one of the options or a number in range.

`decider()` assumes you already deployed a Strands Decider and it is ready. It does not host or check the model. Every host takes the same request, so only the way the call is sent changes. Pass `endpoint` or one `transport`:

| Host | Option | How the call goes | Needs |
|---|---|---|---|
| Any server, such as `strands-decider serve` | `endpoint` | `fetch` to the server's `POST /v1/systemone` route | A URL the function can reach |
| Amazon SageMaker real-time endpoint | `transport: sageMakerTransport({ endpointName })` | AWS SDK `InvokeEndpoint` | `@aws-sdk/client-sagemaker-runtime`, and `sagemaker:InvokeEndpoint` on the endpoint |
| AWS Lambda function | `transport: lambdaTransport({ functionName })` | AWS SDK `Invoke`, with the request as the event | `@aws-sdk/client-lambda`, and `lambda:InvokeFunction` on the function |
| [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/) | `transport: agentCoreTransport({ runtimeArn })` | AWS SDK `InvokeAgentRuntime` | `@aws-sdk/client-bedrock-agentcore`, and `bedrock-agentcore:InvokeAgentRuntime` on the runtime |
| Anything else | `transport` | Your own function | Nothing |

The [Strands Decider repository](https://github.com/strands-labs/strands-decider/tree/main/deploy) has CDK stacks that deploy the model to SageMaker and to Lambda.

```typescript
// A Strands Decider on a SageMaker endpoint.
const decide = decider({
  transport: sageMakerTransport({ endpointName: "strands-decider-2b-qwen3-5-v1-2610" }),
});

// A Strands Decider as a Lambda function, through its live alias.
const decideLambda = decider({
  transport: lambdaTransport({ functionName: "strands-decider-2b-qwen3-5-v1-2610", qualifier: "live" }),
});

// A Strands Decider on AgentCore Runtime.
const decideAgentCore = decider({
  transport: agentCoreTransport({
    runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/strands-decider-abc",
  }),
});

// A Strands Decider at a URL.
const decideHttp = decider({
  endpoint: "https://decider.example.com/v1/systemone",
  headers: { authorization: `Bearer ${token}` },
  threshold: 0.7,
});
```

- Pass only one of `endpoint` and `transport`. Without either, `decider()` uses the `STRANDS_DECIDER_ENDPOINT` environment variable, and throws a `TypeError` when it is not set.
- The AWS transports sign the call with the function's credentials. Each takes a `client` to replace the default AWS SDK client, for example to set a Region.
- Each AWS SDK client is an optional peer dependency. Install only the one you use. Without it, a call through that transport fails with an `AiError` that names the package.
- On SageMaker and AgentCore Runtime, the call reaches the server's `POST /invocations` route, which the Strands Decider server answers like `/v1/systemone`. The 0.2.0 release on PyPI has no `/invocations` route, so deploy a later version. `agentCoreTransport`'s `qualifier` names a runtime endpoint.
- On SageMaker, an HTTP error from the server becomes a `DeciderError` with the server's status.
- On Lambda, the function fails the invocation when it refuses a request, for example an input that does not fit the window. That becomes a `DeciderError` with status 422, which is not retried. Any other function error is retried. `lambdaTransport` does not use the function's Function URL. A new execution environment loads the model first, which can take 30 seconds without SnapStart.
- `decider()` throws a `TypeError` when the endpoint is not an absolute `http:` or `https:` URL.
- An endpoint with a user name or password is refused: pass credentials in `headers`. Redirects are not followed, so your headers never reach another server. Errors name the endpoint without its query, because errors are checkpointed.
- `check` and `label` answer yes when the model's probability of yes is at least `threshold`, 0.5 by default.

## `llm()`

```typescript
const model = llm({
  destination: { bedrock: { modelId: "global.anthropic.claude-sonnet-5-5", maxTokens: 2048 } },
});
```

- The default model is Claude Haiku 5.5 (`global.anthropic.claude-haiku-5-5`, exported as `DEFAULT_LLM_MODEL_ID`). Bedrock has no alias that follows the newest model of a family. So the default is pinned, and a later release of this package moves it to a newer model. Set `modelId` to keep one model.
- `destination` holds exactly one key. This release supports `bedrock` only.
- `ask` sends a temperature only when you set one, because some newer models, such as Claude Haiku 5.5, reject it.
- `system` adds your own instructions after the built-in system prompt. `guardrail` (`{ identifier, version }`) applies a Bedrock guardrail. `client` replaces the default `BedrockRuntimeClient`, for example to set a Region.
- Pass `{ bedrock: { modelId, maxTokens, temperature } }` in the last argument of `ask` to change them for one call.

## Limits

| Operation | Limits |
|---|---|
| All | `question` is a non-empty string. `input` is a string or a value that `JSON.stringify` can encode. |
| `decider()` operations | The model reads the input and each question, with its choices, in one context window: 4,096 tokens for Strands Decider 2B. A request that does not fit fails with `DeciderError` and HTTP 422, which is not retried. Shorten the input before the call. |
| `classify` | 2 to 255 choices (`MAX_CLASSIFY_OPTIONS`). Choices are non-empty and differ after trimming and ignoring case. The model always picks one, so add a choice such as `"other"` when none may fit. |
| `label` | At least 2 choices, with the same rules. Each choice is one yes-or-no question, so each adds time. |
| `score` | 2 to 10 entries (`MAX_SCORE_LEVELS`), from lowest to highest. |
| `ask` | The reply is at most `maxTokens`, 1024 by default. The reply must fit the 256 KB checkpoint limit. |

A call that breaks an argument limit creates no durable operation. The returned promise rejects with a `TypeError` or a `RangeError`.

## What a call does

1. The call checks its arguments against the limits above.
2. One step sends one request. The step is named `decider.<operation>` or `llm.ask`. Pass `{ name }` in the last argument to rename it. Renaming an existing call breaks executions in flight.
3. The step has a subtype from `AiOperationSubType`: `DeciderCheck`, `DeciderClassify`, `DeciderLabel`, `DeciderScore`, or `LlmAsk`.
4. The step result is the answer. The input is not checkpointed.

`ask` sends the input inside `<input>` tags, and its system prompt says that the input is data, not instructions. The decider operations can only return one of your options or a number in range. An instruction in the input can still change the answer. So do not use an answer alone to authorize an action.

## Cancellation

Each request listens to two signals: the step's own `signal`, and the invocation deadline. The SDK fires the step's signal when it no longer needs the result, for example when a `map` or `parallel` batch completes early. The request then stops. That stop is not an `AiTimeoutError`.

## Errors and retries

Every error class extends `AiError`, which extends the SDK's `DurableOperationError`. A call rejects with the class that the step's last attempt threw, on the first run and on replay. `DeciderError.status` and `LlmStoppedError.stopReason` are stored in `errorData`, so they are the same on replay. Any other step failure, such as an AWS access-denied error, rejects with the SDK's `StepError`. A caller's own `runInChildContext` wraps the failure in `ChildContextError`, whose inner `StepError` has the AI error type as `cause.name`.


| Error | When | Retried |
|---|---|---|
| `AiTimeoutError` | A request is still running 10 seconds before the invocation runs out of time. A deadline that cannot be read counts as no deadline. | Yes, in a new invocation |
| `DeciderError` | The decision model cannot be reached, its reply cannot be read, or it answers with an HTTP error (including 422 for an input that is too long) | On no answer, 408, 429, and 5xx |
| `DeciderInvalidResponseError` | The decision model's reply is not JSON, has the wrong shape, or has a score outside the scale | No |
| `LlmMaxTokensError` | The `ask` reply stops at `maxTokens` | No |
| `LlmStoppedError` | The `ask` reply stops for another reason, such as a guardrail that intervened. Its `stopReason` says why. | Only `malformed_model_output` and `malformed_tool_use` |

The step retry strategy is `defaultAiRetryStrategy`. It also retries throttling, server errors, and connection failures, up to 5 attempts. It does not retry access-denied or validation errors, because they repeat. Pass `retryStrategy` to `decider()` or `llm()` to replace it.

## Permissions

`ask` needs `bedrock:InvokeModel` on the model, and on the inference profile when the model ID names one. A guardrail also needs `bedrock:ApplyGuardrail`. `@aws-sdk/client-bedrock-runtime` is an optional peer dependency. Install it to use `llm()`. Without it, `decider()` still works, a bundler such as esbuild still builds, and `ask` fails with an `AiError` that names the package. `decider()` needs the permission of its transport, listed in the table above. With `endpoint` or your own `transport` it needs no AWS permission.

## Testing

Pass a fake as `transport` to `decider()`, as `client` to an AWS transport, and as `destination.bedrock.client` to `llm()`. `LocalDurableTestRunner` then runs a handler without AWS credentials or a model server. The [decider custom transport example](../../aws-durable-execution-sdk-js-examples/src/examples/ai/decider-custom-transport/decider-custom-transport.ts) shows a transport that answers without a model. `src/ai/__tests__/live.test.ts` runs the operations against a real decision model server and Bedrock when `AI_LIVE=1`. `e2e/run-ai-e2e.mjs deploy` deploys a durable function that runs `ask` and checks the result and the history.

