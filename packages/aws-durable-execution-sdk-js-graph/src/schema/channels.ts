/**
 * State channels and reducers.
 *
 * A graph's state is a set of named *channels*. Each channel has:
 *   - an `init()` that produces its starting value, and
 *   - a `reduce(current, update)` that folds an incoming update into the current value.
 *
 * This mirrors LangGraph's channel/reducer model (design doc §4.5). The critical property
 * for this runtime is that **reducers must be pure** (brief invariant 3): they run *outside*
 * durable steps in {@link runGraph}, so they re-execute on every replay. A reducer that reads
 * the clock, calls `Math.random()`, or performs I/O will diverge on replay and silently
 * corrupt state. We keep the surface plain-JSON only — no `@langchain/core` (brief scope).
 */

/**
 * A single state channel: how to initialise it and how to fold updates into it.
 *
 * @typeParam TValue - The channel's stored value type.
 * @typeParam TUpdate - The delta type a node may emit for this channel. Defaults to `TValue`
 *   (last-write-wins), but can differ — e.g. an append channel stores `T[]` and accepts
 *   either a single `T` or a `T[]`.
 */
export interface Channel<TValue, TUpdate = TValue> {
  /** Produce the channel's initial value. MUST be pure. */
  init(): TValue;
  /**
   * Fold an update into the current value, returning the new value. MUST be pure and MUST
   * NOT mutate `current` — return a fresh value so replay folding is repeatable.
   */
  reduce(current: TValue, update: TUpdate): TValue;
}

/**
 * Last-write-wins channel: `reduce` simply returns the update, discarding the prior value.
 * This is the default channel semantics in LangGraph when no reducer is supplied.
 *
 * @param initial - The initial value.
 */
export function lastValue<TValue>(initial: TValue): Channel<TValue> {
  return {
    init: () => initial,
    // Pure: no mutation, ignores prior value by design.
    reduce: (_current, update) => update,
  };
}

/**
 * Append channel: accumulates values into an array. Accepts either a single item or an array
 * of items as the update, matching LangGraph's `messages`-style additive reducer. Always
 * returns a new array (never mutates `current`).
 *
 * @param initial - Optional initial contents (defaults to empty).
 */
export function appendValue<TItem>(
  initial: readonly TItem[] = [],
): Channel<TItem[], TItem | TItem[]> {
  return {
    init: () => [...initial],
    reduce: (current, update) =>
      Array.isArray(update) ? [...current, ...update] : [...current, update],
  };
}

/**
 * Convenience channel for a chat-style `messages` array. Identical to {@link appendValue} but
 * named to read like LangGraph's `MessagesValue`. Messages are plain JSON objects in the POC
 * (no `BaseMessage` classes, no class serdes — brief scope).
 *
 * @typeParam TMessage - The message shape. Defaults to a minimal role/content record.
 */
export function messagesValue<
  TMessage = { role: string; content: string },
>(): Channel<TMessage[], TMessage | TMessage[]> {
  return appendValue<TMessage>();
}
