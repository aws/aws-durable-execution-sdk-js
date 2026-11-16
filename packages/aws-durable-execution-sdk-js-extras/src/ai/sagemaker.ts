import {
  decode,
  encode,
  lazyClient,
  once,
  parseReply,
  sdkLoadError,
} from "./aws-sdk";
import { DeciderError } from "./errors";
import type { AwsSdkClient, DeciderTransport, SageMakerConfig } from "./types";

const loadSdk = once(() =>
  import("@aws-sdk/client-sagemaker-runtime").catch(
    sdkLoadError("@aws-sdk/client-sagemaker-runtime", "sageMakerTransport()"),
  ),
);

/**
 * The error that `InvokeEndpoint` throws when the container answers with an
 * HTTP error.
 */
interface ModelError extends Error {
  OriginalStatusCode?: number;
  OriginalMessage?: string;
}

/**
 * Returns a transport that sends each request to a Strands Decider deployed
 * on an Amazon SageMaker real-time endpoint, through `InvokeEndpoint`.
 *
 * @remarks
 * SageMaker forwards the request to the server's `POST /invocations` route.
 * The Strands Decider server answers that route the same way as
 * `POST /v1/systemone`. The Strands Decider repository has a CDK stack that
 * deploys such an endpoint (`deploy/sagemaker`).
 *
 * The AWS SDK signs the request with the function's credentials. So the
 * function's role needs `sagemaker:InvokeEndpoint` on the endpoint.
 *
 * When the server answers with an HTTP error, SageMaker throws `ModelError`.
 * The transport turns it into a `DeciderError` with the server's status. So
 * a 422 for an input that is too long is not retried.
 *
 * `@aws-sdk/client-sagemaker-runtime` is an optional peer dependency. Without
 * it, each call fails with an `AiError` that names the package.
 *
 * ```typescript
 * const decide = decider({
 *   transport: sageMakerTransport({ endpointName: "strands-decider-2b-qwen3-5-v1-2610" }),
 * });
 * ```
 *
 * @param config - The endpoint. Only `endpointName` is required.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function sageMakerTransport(config: SageMakerConfig): DeciderTransport {
  const getClient = lazyClient(config.client, () =>
    loadSdk().then(
      ({ SageMakerRuntimeClient }) =>
        new SageMakerRuntimeClient({}) as unknown as AwsSdkClient,
    ),
  );

  return async (request, { abortSignal }) => {
    const { InvokeEndpointCommand } = await loadSdk();
    const command = new InvokeEndpointCommand({
      EndpointName: config.endpointName,
      ContentType: "application/json",
      Accept: "application/json",
      Body: encode(request),
    });
    let output: { Body?: Uint8Array };
    try {
      output = (await (await getClient()).send(command, { abortSignal })) as {
        Body?: Uint8Array;
      };
    } catch (error) {
      const { name, OriginalStatusCode: status } = error as ModelError;
      if (name === "ModelError" && typeof status === "number") {
        const body = (error as ModelError).OriginalMessage ?? "";
        throw new DeciderError(
          `The decision model on SageMaker answered HTTP ${status}: ${body.slice(0, 200)}`,
          { status, cause: error },
        );
      }
      throw error;
    }
    return parseReply(decode(output.Body));
  };
}
