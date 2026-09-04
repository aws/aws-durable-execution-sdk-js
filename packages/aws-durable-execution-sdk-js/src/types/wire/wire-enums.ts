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
