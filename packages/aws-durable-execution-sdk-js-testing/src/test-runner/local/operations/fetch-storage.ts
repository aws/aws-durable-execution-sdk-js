import {
  ErrorObject,
  FetchBodyEncoding,
  FetchDetails,
} from "@aws/durable-execution-sdk-js";

/**
 * The request the simulated backend was asked to issue.
 *
 * Flattened from the checkpoint's `FetchOptions` and payload so a transport does not need to
 * know the wire shape.
 *
 * @public
 */
export interface TestFetchRequest {
  /** Absolute URL to request. */
  readonly url: string;
  /** HTTP method, defaulted to `GET` when the operation did not specify one. */
  readonly method: string;
  /** Request headers. */
  readonly headers: Record<string, string>;
  /** Request body, when the operation carried one. */
  readonly body: string | undefined;
  /** Timeout the operation asked for, when it specified one. */
  readonly timeoutSeconds: number | undefined;
}

/**
 * The response a transport recorded for a request.
 *
 * Return this for any completed exchange, whatever the status — a 404 is a response, not a
 * failure. Throw from the transport to model a request that never completed.
 *
 * @public
 */
export interface TestFetchResponse {
  /** HTTP status code to record. */
  readonly status: number;
  /** Response headers to record. Header names are lowercased before recording. */
  readonly headers?: Record<string, string>;
  /** Response body to record. */
  readonly body?: string;
  /**
   * How {@link TestFetchResponse.body} is encoded, when modelling a backend that records
   * something other than UTF-8 text. Absent means {@link FetchBodyEncoding.UTF8}.
   *
   * The SDK only reads `UTF8` bodies, so setting this to `BASE64` models a backend newer than
   * the SDK reading it — useful for asserting that the mismatch surfaces as a clear error
   * rather than a corrupted body.
   */
  readonly bodyEncoding?: FetchBodyEncoding;
}

/**
 * Performs the HTTP request on behalf of the simulated backend.
 *
 * @public
 */
export type TestFetchTransport = (
  request: TestFetchRequest,
) => Promise<TestFetchResponse>;

/**
 * A transport backed by the runtime's global `fetch`, for tests that want to reach a real
 * endpoint — a local HTTP server stood up by the test, for instance.
 *
 * Not the default: a test runner that silently makes live requests would make unit tests
 * depend on the network, so reaching the outside world is something a test opts into.
 *
 * @public
 */
export const globalFetchTransport: TestFetchTransport = async (request) => {
  const response = await globalThis.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    ...(request.timeoutSeconds !== undefined && {
      signal: AbortSignal.timeout(request.timeoutSeconds * 1000),
    }),
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    headers,
    body: await response.text(),
  };
};

/**
 * Holds the transport the local runner uses to satisfy fetch operations, and converts its
 * outcome into the `FetchDetails` the backend records.
 *
 * The parallel to `FunctionStorage` is deliberate: both stand in for something outside the
 * execution that the runner has to provide, and both refuse to guess. Where
 * `FunctionStorage` requires functions to be registered before a chained invoke can reach
 * them, this requires a transport to be registered before a fetch can be issued.
 */
export class FetchStorage {
  private transport: TestFetchTransport | undefined;

  /**
   * Registers the transport used to satisfy fetch operations.
   *
   * @param transport - Performs the request, or throws to model a transport failure
   */
  registerTransport(transport: TestFetchTransport): void {
    this.transport = transport;
  }

  /**
   * Issues a fetch request and reports what the backend should record against the
   * operation.
   *
   * A returned response becomes `SUCCEEDED` no matter its status code. A transport that
   * throws becomes a recorded error, which is how a timeout or connection failure reaches
   * the workflow.
   *
   * @param request - The request to issue
   * @returns The details to record, and whether an exchange completed
   */
  async runFetch(request: TestFetchRequest): Promise<{
    details: FetchDetails;
    completed: boolean;
  }> {
    const transport = this.transport;

    if (!transport) {
      throw new Error(
        `No fetch transport registered, so the fetch to ${request.url} cannot be issued.\n` +
          `Please configure one with LocalDurableTestRunner.registerFetchTransport, or pass ` +
          `globalFetchTransport to reach a real endpoint.`,
      );
    }

    try {
      // Annotated rather than inferred: Biome's `useAwaitThenable` does not follow the
      // return type through the `TestFetchTransport` alias, and this package gates that
      // rule at error. Naming the promise type here keeps the check satisfied without a
      // suppression.
      const pending: Promise<TestFetchResponse> = transport(request);
      const response = await pending;

      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers ?? {})) {
        headers[name.toLowerCase()] = value;
      }

      return {
        completed: true,
        details: {
          StatusCode: response.status,
          Headers: headers,
          Result: response.body,
          // Left absent for UTF-8, which is what the compatibility rule relies on: a reader
          // that predates the field treats an absent encoding as UTF-8 and is therefore
          // correct, and only a body that is genuinely something else carries the marker.
          ...(response.bodyEncoding !== undefined &&
            response.bodyEncoding !== FetchBodyEncoding.UTF8 && {
              BodyEncoding: response.bodyEncoding,
            }),
        },
      };
    } catch (err: unknown) {
      return { completed: false, details: { Error: toErrorObject(err) } };
    }
  }
}

/**
 * Converts a thrown transport failure into the error shape recorded on the operation.
 *
 * `TimeoutError` is what `AbortSignal.timeout` produces, and is mapped to the SDK's
 * `FetchError` type name so the deserialized error reads the same as any other fetch
 * failure.
 */
const toErrorObject = (err: unknown): ErrorObject => {
  if (err instanceof Error) {
    return {
      ErrorMessage: err.message,
      ErrorType: "FetchError",
      StackTrace: err.stack?.split("\n"),
    };
  }

  return { ErrorMessage: String(err), ErrorType: "FetchError" };
};
