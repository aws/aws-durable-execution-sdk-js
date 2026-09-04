import { Readable } from "node:stream";
import type { DurableContext } from "@aws/durable-execution-sdk-js";

/**
 * Routes an AWS SDK v3 client's HTTP traffic through `context.fetch`, so calls to AWS
 * services become durable operations.
 *
 * ## Why a request handler rather than a wrapper
 *
 * There is no way to wrap `await client.send(command)` after the fact -- by the time a
 * wrapper sees that value the call has already gone out. The interception has to happen
 * inside the client, and `@smithy/smithy-client` resolves the middleware stack like this:
 *
 * ```js
 * stack.resolve((request) => requestHandler.handle(request.request, options), ctx)
 * ```
 *
 * The request handler is the *terminal* handler, so serialization, endpoint resolution,
 * signing and retry all run above it. Swapping it replaces the socket, and nothing else.
 *
 * ## What this means for signing
 *
 * The request arriving here is already SigV4-signed, by the Lambda, using the execution
 * role's credentials. Two consequences worth understanding before using this:
 *
 * - The `Authorization` and `x-amz-security-token` headers travel to the durable execution
 *   service in the checkpoint. That service is Lambda, which already holds those
 *   credentials, so this is not a new trust boundary -- but the headers are deliberately
 *   *not* recorded in the execution history, which is readable by anyone with Lambda read
 *   access to the function. See `FetchOptions` in the SDK.
 *
 * - **Signatures expire.** SigV4 tolerates roughly five minutes of clock skew, and the
 *   signature is produced in the Lambda but used by the service at dispatch. In the normal
 *   path that gap is seconds. If it is not, the endpoint returns 403 and the AWS SDK throws
 *   its own typed error for it (`InvalidSignatureException`, `RequestTimeTooSkewed`,
 *   `ExpiredTokenException`, ...), which is why no bespoke classification lives here: the
 *   SDK already names the failure. A retry issues a *new* fetch on a later invocation and is
 *   therefore signed afresh, so a stale signature is self-healing if the workflow retries.
 *
 * ## Limitations
 *
 * `FetchResponse.body` is a string, so this suits JSON APIs -- `InvokeModel`, DynamoDB, most
 * control-plane calls. It cannot carry a binary or streamed response:
 * `InvokeModelWithResponseStream` and `S3.GetObject` will not work correctly until the wire
 * shape can express binary. The response is materialized in full before the workflow sees
 * it, and lands in a checkpoint, so it is also subject to checkpoint payload limits.
 *
 * @example
 * ```typescript
 * const client = new BedrockRuntimeClient({
 *   region: "us-east-1",
 *   requestHandler: durableRequestHandler(context, "invoke-model"),
 *   // Let the workflow own retries. The SDK's own backoff is an in-Lambda setTimeout,
 *   // which burns billed compute while a durable retry would suspend instead.
 *   maxAttempts: 1,
 * });
 *
 * const response = await client.send(command);
 * ```
 */
export const durableRequestHandler = (
  context: DurableContext,
  name: string,
): DurableRequestHandler => new DurableRequestHandler(context, name);

/**
 * The subset of `@smithy/protocol-http`'s `HttpRequest` this handler reads.
 *
 * Declared here rather than imported so the example carries no dependency on the AWS SDK's
 * internals. `HttpRequest` is structural, and these are the fields a signed request arrives
 * with.
 */
export interface SmithyHttpRequest {
  method: string;
  protocol: string;
  hostname: string;
  port?: number | undefined;
  path: string;
  query: Record<string, string | string[] | null> | undefined;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * The response shape the middleware stack expects back.
 *
 * `HttpResponse.isInstance` is duck-typed -- it checks only that `statusCode` is a number
 * and `headers` is an object -- so a plain object satisfies the stack and this file needs no
 * runtime import from `@smithy/protocol-http`.
 */
export interface SmithyHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Serializes a smithy query bag back into a query string.
 *
 * The signature covers the canonical query string, so the order and encoding the signer saw
 * must be preserved. Smithy sorts parameters when signing, so sorting here reproduces it.
 */
const formatQuery = (query: SmithyHttpRequest["query"] | undefined): string => {
  if (!query) {
    return "";
  }

  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === null || value === undefined) {
      // A valueless parameter, which canonicalizes to `key=`.
      parts.push(`${encodeURIComponent(key)}=`);
      continue;
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(entry)}`);
    }
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
};

/**
 * Reduces a signed request body to the string `context.fetch` carries.
 *
 * A binary or streaming body cannot survive a string round trip, and silently truncating one
 * would corrupt a signed request -- so this refuses rather than guesses.
 */
const toFetchBody = (body: unknown): string | undefined => {
  if (body === undefined || body === null || body === "") {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  throw new Error(
    `durableRequestHandler cannot carry a ${
      body instanceof Uint8Array ? "binary" : typeof body
    } request body: context.fetch carries the body as a string. ` +
      `Use this handler for JSON APIs, and a regular request handler for binary or ` +
      `streaming operations.`,
  );
};

/**
 * A smithy request handler backed by `context.fetch`. Construct through
 * {@link durableRequestHandler}.
 */
export class DurableRequestHandler {
  constructor(
    private readonly context: DurableContext,
    /**
     * Operation name for the underlying fetch.
     *
     * Caller-supplied and required, deliberately. Replay validation compares the recorded
     * operation name exactly, so deriving it from the request -- whose path or query can
     * vary between attempts -- risks failing the execution for non-determinism that is not
     * really there.
     */
    private readonly name: string,
  ) {}

  async handle(
    request: SmithyHttpRequest,
  ): Promise<{ response: SmithyHttpResponse }> {
    const port = request.port ? `:${request.port}` : "";
    const url = `${request.protocol}//${request.hostname}${port}${request.path}${formatQuery(request.query)}`;

    const response = await this.context.fetch(this.name, url, {
      method: request.method,
      headers: request.headers,
      body: toFetchBody(request.body),
    });

    return {
      response: {
        statusCode: response.status,
        headers: response.headers,
        // A Readable, matching what NodeHttpHandler hands back. The stack reads this two
        // ways -- `collectBody` for modelled responses and `sdkStreamMixin` for streamed
        // members -- and both accept a Node stream, whereas a bare string satisfies
        // neither. Error deserialization goes through the same path, so getting this wrong
        // silently discards the service's error code and leaves a generic failure.
        body: Readable.from([Buffer.from(response.body, "utf8")]),
      },
    };
  }

  /** Required by the smithy handler interface; there is no socket to configure. */
  updateHttpClientConfig(): void {}

  /** Required by the smithy handler interface. */
  httpHandlerConfigs(): Record<string, never> {
    return {};
  }
}
