import {
  DurableContext,
  Duration,
  Serdes,
} from "@aws/durable-execution-sdk-js";
import { NodeContext } from "../builder/node";

/**
 * Config accepted by {@link interrupt}, mirroring the subset of the core SDK's
 * `WaitForCallbackConfig` we need.
 *
 * NOTE (SDK friction, see POC_FINDINGS.md): the core SDK's `WaitForCallbackConfig` type is a
 * *forgotten export* in v2.3.0 — api-extractor flags it as needing export from the entry point,
 * and it is not re-exported from the package root, so a consumer cannot name it. We therefore
 * redeclare the fields we pass through. `Duration` and the callback's serdes shape are public,
 * so the structural type is faithful.
 *
 * @typeParam TResume - The deserialised resume-payload type.
 */
export interface InterruptConfig<TResume> {
  /** Maximum time to wait for the callback before it times out. */
  timeout?: Duration;
  /** Heartbeat timeout to detect stalled operations. */
  heartbeatTimeout?: Duration;
  /** Deserialiser for a structured (non-string) resume payload. Matches the SDK's callback serdes shape. */
  serdes?: Omit<Serdes<TResume>, "serialize">;
}

/**
 * Human-in-the-loop interrupt.
 *
 * Design doc §4.6: because this runtime owns node dispatch, `interrupt` is **not** a thrown
 * sentinel that must be caught and lifted (as in LangGraph). It is a direct call on the node's
 * own durable context. The node awaits {@link DurableContext.waitForCallback}; the invocation
 * ends, nothing is billed while suspended, and an external system resumes it by calling
 * `SendDurableExecutionCallbackSuccess` with the resume payload (up to a year later).
 *
 * The submitter receives the callback id and is where you notify the external reviewer. It runs
 * inside the callback operation, so it may perform I/O (e.g. send a notification); that I/O is
 * durably recorded by the SDK.
 *
 * @typeParam TResume - The type the resume payload deserialises to. Defaults to `string`
 *   (the SDK's default callback payload type). For structured payloads, provide a `serdes` in
 *   `config` and parameterise accordingly.
 *
 * @param nodeCtx - The {@link NodeContext} handed to the node body.
 * @param name - A stable local label for this interrupt within the node (part of the
 *   structural path; must not depend on state/clock/RNG — brief invariant 4).
 * @param submitter - Notifies the external system with the callback id.
 * @param config - Optional timeout / serdes.
 * @returns The resume value delivered by the callback.
 */
export function interrupt<TResume = string>(
  nodeCtx: NodeContext,
  name: string,
  submitter: (callbackId: string) => Promise<void>,
  config?: InterruptConfig<TResume>,
): Promise<TResume> {
  const ctx: DurableContext = nodeCtx.ctx;
  return ctx.waitForCallback<TResume>(
    name,
    async (callbackId) => {
      await submitter(callbackId);
    },
    config,
  );
}
