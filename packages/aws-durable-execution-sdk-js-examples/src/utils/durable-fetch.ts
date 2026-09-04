import type { DurableContext } from "@aws/durable-execution-sdk-js";

/**
 * Statuses the `Response` constructor refuses to pair with a body.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * The parameter types of whatever `fetch` is in scope.
 *
 * Derived rather than written out: `RequestInfo` is a DOM global that is not present under
 * every `lib` configuration, whereas taking the types from `globalThis.fetch` is correct
 * wherever this compiles and keeps the adapter's signature identical to the function it
 * substitutes for.
 */
type FetchParameters = Parameters<typeof globalThis.fetch>;

/**
 * Builds a `fetch`-compatible function that routes every request through `context.fetch`,
 * turning calls made by any fetch-based client into durable operations.
 *
 * ## Why this covers so much
 *
 * There are two HTTP injection points in common use. AWS SDK v3 clients take a smithy
 * `requestHandler` (see `durableRequestHandler`); nearly everything else — the OpenAI and
 * Anthropic SDKs, the Vercel AI SDK's providers, LangChain's wrappers around them — accepts a
 * `fetch` implementation. Because that contract is a web standard rather than a library
 * internal, one adapter serves all of them.
 *
 * A real `Response` is returned, so the caller's `.json()`, `.text()`, `.ok` and `.body` all
 * behave normally and the client cannot tell the difference.
 *
 * ## Streaming
 *
 * Server-sent events parse correctly but are **not incremental**. `context.fetch` resolves
 * once the whole exchange is recorded, so the `ReadableStream` handed back emits the entire
 * transcript at once. An SSE parser is perfectly happy with that and yields every event, so
 * `stream: true` and `streamText` produce correct results — but tokens arrive in one burst,
 * which is useless for streaming to a UI and fine for an agent loop that only needs the final
 * message.
 *
 * Two consequences follow: the whole generation has to finish inside the fetch timeout, and
 * the entire transcript lands in a checkpoint, so long outputs run into payload limits.
 *
 * ## Turn off client-side retries
 *
 * These clients retry in-process with `setTimeout` backoff, which spends billed Lambda time
 * asleep. Pass `maxRetries: 0` and retry at the workflow level instead, where the wait
 * suspends.
 *
 * @param context - The durable context to record operations against
 * @param name - Operation name. Every request through this fetch shares it; replay is
 * unaffected because operation ids are positional, but a distinct name per client makes the
 * execution history far easier to read.
 *
 * @example
 * ```typescript
 * const client = new OpenAI({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   fetch: durableFetch(context, "chat-completions"),
 *   maxRetries: 0,
 * });
 * ```
 */
export const durableFetch = (
  context: DurableContext,
  name: string,
): typeof globalThis.fetch => {
  const durableFetchImpl = async (
    input: FetchParameters[0],
    init?: FetchParameters[1],
  ): Promise<Response> => {
    // Normalizes the three input forms -- string, URL and Request -- in one step, and gives
    // a uniform way to read the body and headers back out.
    const request = new Request(input, init);

    const body = request.body ? await request.text() : undefined;

    const response = await context.fetch(name, request.url, {
      method: request.method,
      // Header names come out of `Headers` already lowercased, matching what the operation
      // records.
      headers: Object.fromEntries(request.headers),
      body,
    });

    return new Response(
      NULL_BODY_STATUSES.has(response.status) ? null : response.body,
      { status: response.status, headers: response.headers },
    );
  };

  return durableFetchImpl as typeof globalThis.fetch;
};
