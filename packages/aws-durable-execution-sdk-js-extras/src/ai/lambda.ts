import {
  decode,
  encode,
  lazyClient,
  once,
  parseReply,
  sdkLoadError,
} from "./aws-sdk";
import { DeciderError } from "./errors";
import type { AwsSdkClient, DeciderTransport, LambdaConfig } from "./types";

const loadSdk = once(() =>
  import("@aws-sdk/client-lambda").catch(
    sdkLoadError("@aws-sdk/client-lambda", "lambdaTransport()"),
  ),
);

/**
 * The error types that the Strands Decider function raises for a request it
 * refuses. The same request fails the same way again.
 */
const REFUSED_ERROR_TYPES: ReadonlySet<string> = new Set([
  "ValidationError",
  "ValueError",
]);

interface InvokeOutput {
  FunctionError?: string;
  Payload?: Uint8Array;
}

/**
 * Returns a transport that sends each request to a Strands Decider deployed
 * as an AWS Lambda function, through a direct `Invoke`.
 *
 * @remarks
 * The function takes the request as its event and returns the reply. The
 * Strands Decider repository has a CDK stack that deploys such a function
 * (`deploy/lambda`). The transport does not use the function's Function URL.
 *
 * The AWS SDK signs the request with the function's credentials. So the
 * calling function's role needs `lambda:InvokeFunction` on the decider
 * function.
 *
 * The function fails the invocation when it refuses a request, for example
 * when the input does not fit the model's window. The transport turns that
 * failure into a `DeciderError` with status 422, the status that the server
 * answers over HTTP. So it is not retried. Any other function error becomes a
 * `DeciderError` with no status, which is retried.
 *
 * A request waits while a new execution environment loads the model, up to
 * 30 seconds without SnapStart.
 *
 * `@aws-sdk/client-lambda` is an optional peer dependency. Without it, each
 * call fails with an `AiError` that names the package.
 *
 * ```typescript
 * const decide = decider({
 *   transport: lambdaTransport({
 *     functionName: "strands-decider-2b-qwen3-5-v1-2610",
 *     qualifier: "live",
 *   }),
 * });
 * ```
 *
 * @param config - The function. Only `functionName` is required.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function lambdaTransport(config: LambdaConfig): DeciderTransport {
  const getClient = lazyClient(config.client, () =>
    loadSdk().then(
      ({ LambdaClient }) => new LambdaClient({}) as unknown as AwsSdkClient,
    ),
  );

  return async (request, { abortSignal }) => {
    const { InvokeCommand } = await loadSdk();
    const command = new InvokeCommand({
      FunctionName: config.functionName,
      ...(config.qualifier !== undefined && { Qualifier: config.qualifier }),
      Payload: encode(request),
    });
    const output = (await (
      await getClient()
    ).send(command, {
      abortSignal,
    })) as InvokeOutput;
    const body = decode(output.Payload);
    if (output.FunctionError !== undefined) {
      const { errorType, errorMessage } = (safeParse(body) ?? {}) as {
        errorType?: unknown;
        errorMessage?: unknown;
      };
      const refused =
        typeof errorType === "string" && REFUSED_ERROR_TYPES.has(errorType);
      const detail =
        typeof errorMessage === "string" ? errorMessage : output.FunctionError;
      throw new DeciderError(
        `The decision model on Lambda failed (${typeof errorType === "string" ? errorType : output.FunctionError}): ${detail.slice(0, 200)}`,
        refused ? { status: 422 } : undefined,
      );
    }
    return parseReply(body);
  };
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
