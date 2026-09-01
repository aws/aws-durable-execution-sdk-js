/**
 * Parity guard between the SDK's own wire model and the AWS SDK's Lambda service model.
 *
 * Note: this is unrelated to the cross-SDK conformance suite in
 * `packages/aws-durable-execution-sdk-js-conformance-tests`, which checks that the
 * JavaScript and Python SDKs behave identically. This file is narrower — it only checks
 * that the type declarations in `wire-model.ts` still match the shapes published by
 * `@aws-sdk/client-lambda`.
 *
 * The SDK declares the service wire shapes itself (see `wire-model.ts`) so that its own
 * type surface does not depend on `@aws-sdk/client-lambda`. That declaration must stay
 * faithful to the service model, so this file compares the two.
 *
 * `@aws-sdk/client-lambda` is imported here for **types only**, and this file is never
 * reachable from `src/index.ts`, so it contributes nothing to the published bundle. The
 * type assertions are checked by `npm run build:types` as well as by ts-jest, so drift
 * fails the build rather than being discovered at runtime.
 *
 * Three kinds of assertion are made, according to the direction each shape travels:
 *
 * - Shapes the SDK **constructs and sends** (requests, updates, options) must be exactly
 *   assignable in both directions, because our value is passed to the AWS SDK.
 * - **Normalized** shapes ({@link Operation} and friends) also match exactly: the SDK
 *   converts wire timestamps to `Date` on the way in, which is what the service model
 *   declares.
 * - **Raw** wire shapes ({@link WireOperation} and friends) are deliberately wider for
 *   timestamps, because the invocation event delivers them as strings — see
 *   {@link WireTimestamp} — so only the service-model-to-ours direction holds.
 *
 * Every shape additionally asserts an identical key set, which catches fields being added
 * to or removed from the service model — plain assignability would not.
 *
 * Scope, and when to change it: Lambda is currently the only backend, so requiring the
 * whole wire model to match Lambda's service model is the strongest available guard. When a
 * second compute backend is supported, this file should be narrowed to cover only the
 * Lambda transport's own shapes — a strict match against one backend's API is the wrong
 * constraint to place on a model shared by several. Treat the assertions here as a check on
 * today's single transport, not as policy for the model.
 */

import type * as Sdk from "@aws-sdk/client-lambda";
import { OperationAction, OperationStatus, OperationType } from "./wire-enums";
import type * as Wire from "./index";

/**
 * Compiles only when `T` is exactly `true`. Any drift surfaces as a type error at the
 * call site naming the offending shape.
 */
const assert = <_T extends true>(): void => undefined;

type Extends<A, B> = [A] extends [B] ? true : false;

type Mutual<A, B> =
  Extends<A, B> extends true
    ? Extends<B, A> extends true
      ? true
      : false
    : false;

type SameKeys<A, B> = Mutual<keyof A, keyof B>;

// ---------------------------------------------------------------------------
// Enumerations — string literal unions must match exactly in both directions.
// ---------------------------------------------------------------------------

assert<Mutual<Wire.OperationType, Sdk.OperationType>>();
assert<Mutual<Wire.OperationStatus, Sdk.OperationStatus>>();
assert<Mutual<Wire.OperationAction, Sdk.OperationAction>>();

// ---------------------------------------------------------------------------
// Shapes we construct and pass to the AWS SDK — exact match required.
// ---------------------------------------------------------------------------

assert<SameKeys<Wire.ErrorObject, Sdk.ErrorObject>>();
assert<Mutual<Wire.ErrorObject, Sdk.ErrorObject>>();

assert<SameKeys<Wire.ContextOptions, Sdk.ContextOptions>>();
assert<Mutual<Wire.ContextOptions, Sdk.ContextOptions>>();

assert<SameKeys<Wire.StepOptions, Sdk.StepOptions>>();
assert<Mutual<Wire.StepOptions, Sdk.StepOptions>>();

assert<SameKeys<Wire.WaitOptions, Sdk.WaitOptions>>();
assert<Mutual<Wire.WaitOptions, Sdk.WaitOptions>>();

assert<SameKeys<Wire.CallbackOptions, Sdk.CallbackOptions>>();
assert<Mutual<Wire.CallbackOptions, Sdk.CallbackOptions>>();

assert<SameKeys<Wire.ChainedInvokeOptions, Sdk.ChainedInvokeOptions>>();
assert<Mutual<Wire.ChainedInvokeOptions, Sdk.ChainedInvokeOptions>>();

assert<SameKeys<Wire.OperationUpdate, Sdk.OperationUpdate>>();
assert<Mutual<Wire.OperationUpdate, Sdk.OperationUpdate>>();

assert<
  SameKeys<
    Wire.CheckpointDurableExecutionRequest,
    Sdk.CheckpointDurableExecutionRequest
  >
>();
assert<
  Mutual<
    Wire.CheckpointDurableExecutionRequest,
    Sdk.CheckpointDurableExecutionRequest
  >
>();

assert<
  SameKeys<
    Wire.GetDurableExecutionStateRequest,
    Sdk.GetDurableExecutionStateRequest
  >
>();
assert<
  Mutual<
    Wire.GetDurableExecutionStateRequest,
    Sdk.GetDurableExecutionStateRequest
  >
>();

// ---------------------------------------------------------------------------
// Normalized shapes. Timestamps are `Date` here, matching the service model
// exactly, so these must agree in both directions.
// ---------------------------------------------------------------------------

assert<SameKeys<Wire.Operation, Sdk.Operation>>();
assert<Mutual<Wire.Operation, Sdk.Operation>>();

assert<SameKeys<Wire.StepDetails, Sdk.StepDetails>>();
assert<Mutual<Wire.StepDetails, Sdk.StepDetails>>();

assert<SameKeys<Wire.WaitDetails, Sdk.WaitDetails>>();
assert<Mutual<Wire.WaitDetails, Sdk.WaitDetails>>();

// ---------------------------------------------------------------------------
// Raw wire shapes. These are deliberately wider than the service model for
// timestamps (see WireTimestamp), so only the service-model-to-ours direction
// holds. The key-set assertions still catch fields being added or removed.
// ---------------------------------------------------------------------------

assert<SameKeys<Wire.WireOperation, Sdk.Operation>>();
assert<Extends<Sdk.Operation, Wire.WireOperation>>();

assert<SameKeys<Wire.WireStepDetails, Sdk.StepDetails>>();
assert<Extends<Sdk.StepDetails, Wire.WireStepDetails>>();

assert<SameKeys<Wire.WireWaitDetails, Sdk.WaitDetails>>();
assert<Extends<Sdk.WaitDetails, Wire.WireWaitDetails>>();

// A normalized operation must be usable wherever a wire operation is expected,
// so that already-normalized history can be fed back through the same paths.
assert<Extends<Wire.Operation, Wire.WireOperation>>();

// ---------------------------------------------------------------------------
// Remaining received shapes — no timestamps, so exact agreement is required.
// ---------------------------------------------------------------------------

assert<SameKeys<Wire.ExecutionDetails, Sdk.ExecutionDetails>>();
assert<Mutual<Wire.ExecutionDetails, Sdk.ExecutionDetails>>();

assert<SameKeys<Wire.ContextDetails, Sdk.ContextDetails>>();
assert<Mutual<Wire.ContextDetails, Sdk.ContextDetails>>();

assert<SameKeys<Wire.CallbackDetails, Sdk.CallbackDetails>>();
assert<Mutual<Wire.CallbackDetails, Sdk.CallbackDetails>>();

assert<SameKeys<Wire.ChainedInvokeDetails, Sdk.ChainedInvokeDetails>>();
assert<Mutual<Wire.ChainedInvokeDetails, Sdk.ChainedInvokeDetails>>();

assert<
  SameKeys<
    Wire.CheckpointUpdatedExecutionState,
    Sdk.CheckpointUpdatedExecutionState
  >
>();
assert<
  Extends<
    Sdk.CheckpointUpdatedExecutionState,
    Wire.CheckpointUpdatedExecutionState
  >
>();

assert<
  SameKeys<
    Wire.CheckpointDurableExecutionResponse,
    Sdk.CheckpointDurableExecutionResponse
  >
>();
assert<
  Extends<
    Sdk.CheckpointDurableExecutionResponse,
    Wire.CheckpointDurableExecutionResponse
  >
>();

assert<
  SameKeys<
    Wire.GetDurableExecutionStateResponse,
    Sdk.GetDurableExecutionStateResponse
  >
>();
assert<
  Extends<
    Sdk.GetDurableExecutionStateResponse,
    Wire.GetDurableExecutionStateResponse
  >
>();

// ---------------------------------------------------------------------------
// Runtime values. The type assertions above cannot see the string values behind
// the literal types once both sides agree, so compare the objects directly.
// ---------------------------------------------------------------------------

describe("wire enums match the AWS SDK service model", () => {
  // Imported for values rather than types, and only inside the test file.
  const sdk = require("@aws-sdk/client-lambda");

  it.each([
    ["OperationType", OperationType],
    ["OperationStatus", OperationStatus],
    ["OperationAction", OperationAction],
  ])(
    "%s has the same members and values as the service model",
    (name, ours) => {
      expect(ours).toEqual(sdk[name as string]);
    },
  );
});
