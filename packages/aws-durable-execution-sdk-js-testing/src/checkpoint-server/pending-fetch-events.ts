/**
 * History event shapes for the `FETCH` operation, pending publication in the Lambda
 * service model.
 *
 * This package simulates the durable execution backend, so it has to record the same
 * history a real execution would. Every other operation type takes its event shapes from
 * `@aws-sdk/client-lambda`, but `FETCH` is newer than the published service model — see the
 * "Pending service members" note in the SDK's `wire-model.aws-sdk-parity.test.ts`, which
 * tracks the same gap on the checkpoint wire.
 *
 * Two different mechanisms are needed because the AWS SDK declares the two halves
 * differently:
 *
 * - `Event` is an `interface`, so the `Fetch*Details` members are added by ordinary
 *   declaration merging below. Every consumer of `keyof Event` picks them up with no
 *   further change, which is why the storage and event-processor layers are untouched.
 * - `EventType` is a `declare const` object, and TypeScript cannot merge members into one.
 *   {@link pendingFetchEventType} is the single place that bridges the gap, so the rest of
 *   the package keeps working with the published `EventType` union.
 *
 * When the service model publishes the Fetch events, delete this file, replace
 * `pendingFetchEventType(...)` calls with `EventType.Fetch*`, and import the detail shapes
 * from `@aws-sdk/client-lambda`.
 */

import {
  EventError,
  EventInput,
  EventResult,
  EventType,
} from "@aws-sdk/client-lambda";

/**
 * Event type names for the fetch operation, mirroring the `ChainedInvoke*` family.
 *
 * There is no `FetchCancelled` because nothing cancels a fetch: it either completes or the
 * enclosing execution stops.
 */
export const FetchEventType = {
  FetchStarted: "FetchStarted",
  FetchSucceeded: "FetchSucceeded",
  FetchFailed: "FetchFailed",
  FetchTimedOut: "FetchTimedOut",
  FetchStopped: "FetchStopped",
} as const;

/**
 * A fetch history event type name. See {@link FetchEventType}.
 */
export type FetchEventTypeName =
  (typeof FetchEventType)[keyof typeof FetchEventType];

/**
 * Presents a fetch event type where the published `EventType` union is expected.
 *
 * The cast is the point of this function, and it is confined to it. The runtime value is a
 * plain string that the service model will publish under the same name, so recorded history
 * is already correct; only the static type is behind. Keeping the cast here means the
 * absence of these members from `EventType` is documented in exactly one place rather than
 * worked around at each call site.
 */
export const pendingFetchEventType = (name: FetchEventTypeName): EventType =>
  name as unknown as EventType;

/**
 * Details about a fetch request that the service has started issuing.
 *
 * The request body travels in `Input`, mirroring `ChainedInvokeStartedDetails`.
 */
export interface FetchStartedDetails {
  /** The URL being requested. */
  Url: string | undefined;
  /** The HTTP method used for the request. */
  Method?: string | undefined;
  /** The request headers. */
  Headers?: Record<string, string> | undefined;
  /** How long the service waits for a response before recording a timeout. */
  Timeout?: number | undefined;
  /** The request body. */
  Input?: EventInput | undefined;
}

/**
 * Details about a fetch that received a response.
 *
 * Recorded for any completed exchange, whatever the status code, so a 500 produces a
 * `FetchSucceeded` event carrying `StatusCode: 500`. `FetchFailed` is reserved for requests
 * that never completed.
 */
export interface FetchSucceededDetails {
  /** The HTTP status code returned by the endpoint. */
  StatusCode: number | undefined;
  /** The response headers, with header names lowercased. */
  Headers?: Record<string, string> | undefined;
  /** The response body. */
  Result?: EventResult | undefined;
}

/**
 * Details about a fetch that could not be completed — DNS failure, connection reset.
 */
export interface FetchFailedDetails {
  /** Details about why the request could not be completed. */
  Error: EventError | undefined;
}

/**
 * Details about a fetch that exceeded its timeout without a response.
 */
export interface FetchTimedOutDetails {
  /** Details about the fetch timeout. */
  Error: EventError | undefined;
}

/**
 * Details about a fetch that was stopped along with its enclosing execution.
 */
export interface FetchStoppedDetails {
  /** Details about why the fetch stopped. */
  Error: EventError | undefined;
}

declare module "@aws-sdk/client-lambda" {
  interface Event {
    /** Details about a fetch request that started. */
    FetchStartedDetails?: FetchStartedDetails | undefined;
    /** Details about a fetch that received a response. */
    FetchSucceededDetails?: FetchSucceededDetails | undefined;
    /** Details about a fetch that could not be completed. */
    FetchFailedDetails?: FetchFailedDetails | undefined;
    /** Details about a fetch that timed out. */
    FetchTimedOutDetails?: FetchTimedOutDetails | undefined;
    /** Details about a fetch that was stopped. */
    FetchStoppedDetails?: FetchStoppedDetails | undefined;
  }
}
