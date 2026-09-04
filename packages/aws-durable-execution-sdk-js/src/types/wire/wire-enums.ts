/**
 * Enumerations for the durable execution wire protocol.
 *
 * These mirror the corresponding enumerations in the Lambda service model. They are
 * declared here — rather than imported from `@aws-sdk/client-lambda` — so the SDK's
 * type surface does not depend on the AWS SDK. The string values are part of the wire
 * contract and must match the service exactly; `wire-model.aws-sdk-parity.test.ts` asserts this
 * against `@aws-sdk/client-lambda` at build and test time.
 *
 * Declared as `const` objects rather than TypeScript `enum`s to match the service model
 * representation: the resulting types are unions of string literals, so a value produced
 * by the AWS SDK and a value produced here are mutually assignable.
 */

/**
 * The kind of durable operation an entry in the execution history represents.
 *
 * @public
 */
export const OperationType = {
  CALLBACK: "CALLBACK",
  CHAINED_INVOKE: "CHAINED_INVOKE",
  CONTEXT: "CONTEXT",
  EXECUTION: "EXECUTION",
  FETCH: "FETCH",
  STEP: "STEP",
  WAIT: "WAIT",
} as const;

/**
 * The kind of durable operation an entry in the execution history represents.
 *
 * @public
 */
export type OperationType = (typeof OperationType)[keyof typeof OperationType];

/**
 * The lifecycle status of a durable operation as recorded by the service.
 *
 * @public
 */
export const OperationStatus = {
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  READY: "READY",
  STARTED: "STARTED",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
} as const;

/**
 * The lifecycle status of a durable operation as recorded by the service.
 *
 * @public
 */
export type OperationStatus =
  (typeof OperationStatus)[keyof typeof OperationStatus];

/**
 * The state transition requested for an operation in a checkpoint request.
 *
 * @public
 */
export const OperationAction = {
  CANCEL: "CANCEL",
  FAIL: "FAIL",
  RETRY: "RETRY",
  START: "START",
  SUCCEED: "SUCCEED",
} as const;

/**
 * The state transition requested for an operation in a checkpoint request.
 *
 * @public
 */
export type OperationAction =
  (typeof OperationAction)[keyof typeof OperationAction];

/**
 * How the body of a fetch operation is encoded on the wire.
 *
 * A fetch body travels as a string, so a body that is not valid UTF-8 text needs an encoding
 * that survives that. This discriminator exists so the encoding is never implied: a reader
 * knows how to interpret a recorded body from the record itself rather than from the version
 * of the SDK that produced it.
 *
 * `UTF8` is the default and the only encoding the SDK currently produces or accepts — a
 * `BASE64` body is rejected rather than guessed at. The member is declared now because the
 * field is far cheaper to introduce before the operation is published than after, when the
 * shape would have to carry both an encoding-less and an encoded form of a body forever.
 *
 * An absent `BodyEncoding` means `UTF8`, which is what makes adding `BASE64` support later a
 * compatible change: an older reader never requests a binary body, so it never receives one
 * it would misread as text.
 *
 * @public
 */
export const FetchBodyEncoding = {
  /** The body is UTF-8 text, carried verbatim. The default when unspecified. */
  UTF8: "UTF8",
  /** The body is arbitrary bytes, base64-encoded. Not yet supported by this SDK. */
  BASE64: "BASE64",
} as const;

/**
 * How the body of a fetch operation is encoded on the wire.
 *
 * @public
 */
export type FetchBodyEncoding =
  (typeof FetchBodyEncoding)[keyof typeof FetchBodyEncoding];
