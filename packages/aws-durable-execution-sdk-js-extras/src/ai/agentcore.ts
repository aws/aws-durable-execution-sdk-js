import { AiError, DeciderError } from "./errors";
import { invalid } from "./shared";
import type {
  AgentCoreConfig,
  AgentCoreInvokeClient,
  DeciderTransport,
} from "./types";

type AgentCoreSdk = typeof import("@aws-sdk/client-bedrock-agentcore");

let sdk: Promise<AgentCoreSdk> | undefined;

/**
 * Loads `@aws-sdk/client-bedrock-agentcore`, an optional peer dependency, on
 * first use.
 *
 * The `.catch` on the `import()` lets a bundler such as esbuild leave a
 * missing package to run time instead of failing the build.
 */
function loadAgentCoreSdk(): Promise<AgentCoreSdk> {
  sdk ??= import("@aws-sdk/client-bedrock-agentcore").catch(
    (cause: unknown) => {
      sdk = undefined;
      const code = (cause as { code?: unknown } | null)?.code;
      throw new AiError(
        code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND"
          ? "decider({ agentCore }) needs the @aws-sdk/client-bedrock-agentcore package. Install it next to this package."
          : "decider({ agentCore }) could not load the @aws-sdk/client-bedrock-agentcore package. See the cause.",
        { cause },
      );
    },
  );
  return sdk;
}

interface InvokeResponse {
  response?: { transformToString(encoding?: string): Promise<string> };
  statusCode?: number;
}

/**
 * Returns a transport that sends each request to a Strands Decider deployed
 * on Amazon Bedrock AgentCore Runtime, through `InvokeAgentRuntime`.
 *
 * AgentCore Runtime forwards the payload to the server's `POST /invocations`
 * route, which the Strands Decider server answers the same way as
 * `POST /v1/systemone`. The AWS SDK signs the request with the function's
 * credentials.
 */
export function agentCoreTransport(config: AgentCoreConfig): DeciderTransport {
  let client: Promise<AgentCoreInvokeClient> | undefined;
  const getClient = (): Promise<AgentCoreInvokeClient> => {
    if (config.client) {
      return Promise.resolve(config.client);
    }
    client ??= loadAgentCoreSdk().then(
      ({ BedrockAgentCoreClient }) =>
        new BedrockAgentCoreClient({}) as unknown as AgentCoreInvokeClient,
    );
    return client;
  };

  return async (request, { abortSignal }) => {
    const { InvokeAgentRuntimeCommand } = await loadAgentCoreSdk();
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: config.runtimeArn,
      ...(config.qualifier !== undefined && { qualifier: config.qualifier }),
      contentType: "application/json",
      accept: "application/json",
      payload: new TextEncoder().encode(JSON.stringify(request)),
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
    try {
      return JSON.parse(body);
    } catch (cause) {
      return invalid("The decision model's reply is not JSON.", cause);
    }
  };
}
