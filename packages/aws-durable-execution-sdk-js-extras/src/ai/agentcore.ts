import { encode, lazyClient, once, parseReply, sdkLoadError } from "./aws-sdk";
import { DeciderError } from "./errors";
import type { AgentCoreConfig, AwsSdkClient, DeciderTransport } from "./types";

const loadSdk = once(() =>
  import("@aws-sdk/client-bedrock-agentcore").catch(
    sdkLoadError("@aws-sdk/client-bedrock-agentcore", "agentCoreTransport()"),
  ),
);

interface InvokeResponse {
  response?: { transformToString(encoding?: string): Promise<string> };
  statusCode?: number;
}

/**
 * Returns a transport that sends each request to a Strands Decider deployed
 * on Amazon Bedrock AgentCore Runtime, through `InvokeAgentRuntime`.
 *
 * @remarks
 * AgentCore Runtime forwards the payload to the server's `POST /invocations`
 * route. The Strands Decider server answers that route the same way as
 * `POST /v1/systemone`. The 0.2.0 release on PyPI has no `/invocations`
 * route, so deploy a later version.
 *
 * The AWS SDK signs the request with the function's credentials. So the
 * function's role needs `bedrock-agentcore:InvokeAgentRuntime` on the
 * runtime.
 *
 * `@aws-sdk/client-bedrock-agentcore` is an optional peer dependency. Without
 * it, each call fails with an `AiError` that names the package.
 *
 * ```typescript
 * const decide = decider({
 *   transport: agentCoreTransport({
 *     runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/strands-decider-abc",
 *   }),
 * });
 * ```
 *
 * @param config - The runtime. Only `runtimeArn` is required.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function agentCoreTransport(config: AgentCoreConfig): DeciderTransport {
  const getClient = lazyClient(config.client, () =>
    loadSdk().then(
      ({ BedrockAgentCoreClient }) =>
        new BedrockAgentCoreClient({}) as unknown as AwsSdkClient,
    ),
  );

  return async (request, { abortSignal }) => {
    const { InvokeAgentRuntimeCommand } = await loadSdk();
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: config.runtimeArn,
      ...(config.qualifier !== undefined && { qualifier: config.qualifier }),
      contentType: "application/json",
      accept: "application/json",
      payload: encode(request),
    });
    const output = (await (
      await getClient()
    ).send(command, {
      abortSignal,
    })) as InvokeResponse;
    const body = (await output.response?.transformToString("utf-8")) ?? "";
    const status = output.statusCode;
    if (status !== undefined && (status < 200 || status >= 300)) {
      throw new DeciderError(
        `The decision model on AgentCore Runtime answered HTTP ${status}: ${body.slice(0, 200)}`,
        { status },
      );
    }
    return parseReply(body);
  };
}
