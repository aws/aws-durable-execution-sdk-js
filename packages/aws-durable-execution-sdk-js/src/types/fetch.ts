import { Duration } from "./core";

/**
 * Configuration options for a fetch operation.
 *
 * @public
 */
export interface FetchConfig {
  /** HTTP method. Defaults to `GET`. */
  method?: string;
  /** Request headers. */
  headers?: Record<string, string>;
  /**
   * Request body, sent verbatim.
   *
   * Deliberately a string rather than an arbitrary value passed through serdes: a fetch
   * body is whatever the endpoint expects, so encoding it is the caller's decision.
   * `JSON.stringify` on a plain object is deterministic, so building the body outside a
   * step is replay-safe.
   */
  body?: string;
  /**
   * How long the service waits for the request before recording a timeout.
   *
   * A timeout is a transport failure — no response was received — so it rejects rather
   * than resolving with a response.
   */
  timeout?: Duration;
}

/**
 * The response recorded for a completed fetch operation.
 *
 * Any completed HTTP exchange resolves, whatever the status code. A 404 or a 500 is a
 * response the endpoint chose to send, so it is checkpointed and returned like any other;
 * inspect {@link FetchResponse.status} or {@link FetchResponse.ok} to decide what it means.
 * Only a request that never completed — DNS failure, connection reset, timeout — rejects,
 * with a `FetchError`.
 *
 * @public
 */
export interface FetchResponse {
  /** HTTP status code returned by the endpoint. */
  status: number;
  /** Whether {@link FetchResponse.status} is in the 2xx range. */
  ok: boolean;
  /** Response headers, with header names lowercased. */
  headers: Record<string, string>;
  /** Response body, as returned by the endpoint. */
  body: string;
}
