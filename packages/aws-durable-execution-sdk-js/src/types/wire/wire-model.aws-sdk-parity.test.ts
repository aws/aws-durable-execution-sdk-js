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
 *
 * ## Pending service members
 *
 * The SDK's wire model can legitimately run *ahead* of the published service model while a
 * new operation type is being rolled out. `FETCH` is in that state: the SDK declares the
 * operation type along with {@link Wire.FetchOptions} and {@link Wire.FetchDetails}, and
 * `@aws-sdk/client-lambda` does not know about them yet.
 *
 * Assertions covering shapes that carry a `Fetch*` member are therefore relaxed from
 * `Mutual`/`SameKeys` to the service-model-to-ours direction only, and the members the SDK
 * adds on top are listed explicitly in {@link PendingOperationTypes} and
 * {@link pendingKeys}. This keeps the guard doing the job that matters — the service
 * removing or renaming something the SDK depends on still fails the build — while allowing
 * the SDK to carry a member the service has not published.
 *
 * When `@aws-sdk/client-lambda` ships `FETCH`, revert each assertion marked
 * `PENDING FETCH` back to `Mutual`/`SameKeys`, delete `PendingOperationTypes` and
 * `pendingKeys`, and add the ordinary exact-match pair for `FetchOptions` and
 * `FetchDetails`.
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

/**
 * Operation types the SDK declares that the published service model does not yet carry.
 *
 * Removing a member from this union is the whole point of it: once the service publishes
 * `FETCH`, the `Exclude` below becomes a no-op and the relaxed assertions can go back to
 * `Mutual`.
 */
type PendingOperationTypes = typeof OperationType.FETCH;

/**
 * Keys the SDK declares on shared shapes that the published service model does not yet
 * carry. Same lifecycle as {@link PendingOperationTypes}.
 */
type PendingKeys = "FetchDetails" | "FetchOptions";

// ---------------------------------------------------------------------------
// Enumerations — string literal unions must match exactly in both directions.
// ---------------------------------------------------------------------------

// PENDING FETCH: exact match once the service model publishes FETCH. Until then, assert
// that the service model is a subset of ours and that the only surplus member is FETCH.
assert<Extends<Sdk.OperationType, Wire.OperationType>>();
assert<
  Mutual<Exclude<Wire.OperationType, PendingOperationTypes>, Sdk.OperationType>
>();

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

// PENDING FETCH: `OperationUpdate` carries `FetchOptions`, which the service model does not
// declare yet. Assert exact agreement on every other key, and that the service's own shape
// is still assignable to ours.
assert<
  Mutual<
    Exclude<keyof Wire.OperationUpdate, PendingKeys>,
    keyof Sdk.OperationUpdate
  >
>();
assert<Extends<Sdk.OperationUpdate, Wire.OperationUpdate>>();

assert<
  SameKeys<
    Wire.CheckpointDurableExecutionRequest,
    Sdk.CheckpointDurableExecutionRequest
  >
>();
// PENDING FETCH: `Updates` carries `OperationUpdate`, whose `Type` now admits `FETCH`, so
// our request is no longer assignable to the service model's — which is exactly the
// intended state while the SDK runs ahead of the published model. The reverse direction
// still holds and is what guards against the service adding or renaming a field.
assert<
  Extends<
    Sdk.CheckpointDurableExecutionRequest,
    Wire.CheckpointDurableExecutionRequest
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

// PENDING FETCH: `Operation` carries `FetchDetails`, which the service model does not
// declare yet. Same treatment as `OperationUpdate` above.
assert<
  Mutual<Exclude<keyof Wire.Operation, PendingKeys>, keyof Sdk.Operation>
>();
assert<Extends<Sdk.Operation, Wire.Operation>>();

assert<SameKeys<Wire.StepDetails, Sdk.StepDetails>>();
assert<Mutual<Wire.StepDetails, Sdk.StepDetails>>();

assert<SameKeys<Wire.WaitDetails, Sdk.WaitDetails>>();
assert<Mutual<Wire.WaitDetails, Sdk.WaitDetails>>();

// ---------------------------------------------------------------------------
// Raw wire shapes. These are deliberately wider than the service model for
// timestamps (see WireTimestamp), so only the service-model-to-ours direction
// holds. The key-set assertions still catch fields being added or removed.
// ---------------------------------------------------------------------------

// PENDING FETCH: `WireOperation` inherits `FetchDetails` from `Operation`.
assert<
  Mutual<Exclude<keyof Wire.WireOperation, PendingKeys>, keyof Sdk.Operation>
>();
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
  // biome-ignore lint/style/noCommonJs: deliberate -- this test compares our wire enums to the AWS SDK's at runtime, so it needs the module's VALUES, and a static import would pull AWS types into the wire model the parity test exists to keep AWS-free. Carried an explicit @typescript-eslint/no-require-imports disable before the Biome migration.
  const sdk = require("@aws-sdk/client-lambda");

  /**
   * Enum members the SDK declares ahead of the published service model. Keep in step with
   * {@link PendingOperationTypes} — see the "Pending service members" note at the top of
   * this file.
   */
  const pendingMembers: Record<string, string[]> = {
    OperationType: [OperationType.FETCH],
  };

  it.each([
    ["OperationType", OperationType],
    ["OperationStatus", OperationStatus],
    ["OperationAction", OperationAction],
  ])(
    "%s has the same members and values as the service model",
    (name, ours) => {
      const pending = pendingMembers[name as string] ?? [];
      const published = Object.fromEntries(
        Object.entries(ours).filter(([, value]) => !pending.includes(value)),
      );

      expect(published).toEqual(sdk[name as string]);
    },
  );

  it.each([["OperationType", OperationType]])(
    "%s declares every pending member as a self-named string value",
    (name, ours) => {
      // A pending member is not checked against the service model, so nothing else would
      // catch a typo in its value. The wire contract requires key and value to agree.
      for (const member of pendingMembers[name as string] ?? []) {
        expect((ours as Record<string, string>)[member]).toBe(member);
      }
    },
  );

  it("stops treating a member as pending once the service model publishes it", () => {
    // Fails when the AWS SDK catches up, which is the signal to tighten the relaxed type
    // assertions above back to Mutual/SameKeys and delete the pending lists.
    for (const [name, members] of Object.entries(pendingMembers)) {
      for (const member of members) {
        expect(sdk[name]).not.toHaveProperty(member);
      }
    }
  });
});
