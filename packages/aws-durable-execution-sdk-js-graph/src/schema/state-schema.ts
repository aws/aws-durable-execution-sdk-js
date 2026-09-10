import { Channel } from "./channels";

/**
 * The set of channel definitions that make up a graph's state. Keys are channel names; values
 * are {@link Channel} definitions. Kept as a type alias so `StateSchema` can be generic over
 * the concrete channel map and infer state/delta shapes from it.
 */
export type ChannelMap = Record<string, Channel<unknown, unknown>>;

/**
 * The full state object for a schema: one property per channel, holding that channel's value.
 */
export type StateOf<C extends ChannelMap> = {
  [K in keyof C]: C[K] extends Channel<infer V, unknown> ? V : never;
};

/**
 * A delta a node may return: a partial map of channel name to that channel's *update* type.
 * Channels omitted from a delta are left unchanged. A node that changes nothing returns `{}`
 * (or `undefined`, treated as `{}`).
 */
export type DeltaOf<C extends ChannelMap> = {
  [K in keyof C]?: C[K] extends Channel<unknown, infer U> ? U : never;
};

/**
 * A `StateSchema` bundles a graph's channels and provides pure {@link init} and {@link reduce}
 * operations over the whole state. This is the unit the superstep driver folds deltas through.
 *
 * Design doc §4.5: state is rebuilt by folding deltas on replay, so both operations here MUST
 * be pure. `reduce` never mutates its input `state`; it returns a shallow-copied object with
 * only the touched channels replaced.
 */
export class StateSchema<C extends ChannelMap> {
  constructor(public readonly channels: C) {}

  /** Channel names, computed once. Sorted for deterministic iteration where it matters. */
  private get channelNames(): (keyof C)[] {
    return Object.keys(this.channels) as (keyof C)[];
  }

  /**
   * Build the initial state by initialising every channel, then folding the optional `input`
   * delta on top. Pure.
   *
   * @param input - Optional initial delta (e.g. the graph's input message). Non-object inputs
   *   are ignored, so callers may pass an arbitrary payload safely.
   */
  init(input?: unknown): StateOf<C> {
    const state = {} as StateOf<C>;
    for (const name of this.channelNames) {
      (state[name] as unknown) = this.channels[name].init();
    }
    if (input && typeof input === "object") {
      return this.reduce(state, input as DeltaOf<C>);
    }
    return state;
  }

  /**
   * Fold one delta into `state`, returning a new state. Only channels present in the delta are
   * reduced; the rest are copied by reference (safe because channel values are treated as
   * immutable by pure reducers). Unknown keys in the delta are ignored rather than throwing,
   * so a node cannot corrupt state by naming a channel that does not exist.
   *
   * Pure and non-mutating.
   */
  reduce(state: StateOf<C>, delta: DeltaOf<C> | undefined): StateOf<C> {
    if (!delta) {
      return state;
    }
    const next = { ...state };
    for (const name of this.channelNames) {
      if (Object.hasOwn(delta, name)) {
        const update = delta[name];
        (next[name] as unknown) = this.channels[name].reduce(
          state[name],
          update,
        );
      }
    }
    return next;
  }
}
