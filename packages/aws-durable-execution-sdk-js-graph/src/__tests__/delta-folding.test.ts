import {
  Channel,
  StateSchema,
  appendValue,
  lastValue,
  messagesValue,
} from "../schema";

/**
 * Design doc §11 test 5 (Delta folding).
 *
 * Two properties, both pure (no runner needed — the fold is CPU over checkpointed state,
 * §4.5):
 *
 *   1. Folding N deltas sequentially equals the expected final state (the fold is associative
 *      over the reducer and order-faithful for append channels).
 *   2. A reducer is NEVER invoked with a partially-applied state: each `reduce` call sees the
 *      channel's fully-consistent prior value, and the whole-state fold hands each channel
 *      reducer only its own channel's current value — never a half-updated object.
 *
 * These are the invariants that make replay-time re-folding safe (POC_FINDINGS §6).
 */

describe("delta folding", () => {
  const schema = new StateSchema({
    messages: messagesValue<{ role: string; content: string }>(),
    counter: lastValue<number>(0),
    tags: appendValue<string>(),
  });

  it("folds N deltas into the expected final state", () => {
    let state = schema.init();
    const deltas = [
      { messages: { role: "user", content: "hi" }, counter: 1, tags: "a" },
      { messages: { role: "assistant", content: "hello" }, counter: 2 },
      { tags: ["b", "c"] },
      { counter: 5 },
    ];
    for (const d of deltas) {
      state = schema.reduce(state, d);
    }
    expect(state).toEqual({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      counter: 5, // last-write-wins
      tags: ["a", "b", "c"], // append, order preserved
    });
  });

  it("re-folding the same delta sequence is idempotent (replay-safe)", () => {
    const deltas = [
      { tags: "x", counter: 1 },
      { tags: ["y", "z"], counter: 2 },
    ];
    const fold = () => {
      let s = schema.init();
      for (const d of deltas) {
        s = schema.reduce(s, d);
      }
      return s;
    };
    // Folding twice from init yields identical state — this is what a replay does.
    expect(fold()).toEqual(fold());
    expect(fold()).toEqual({
      messages: [],
      counter: 2,
      tags: ["x", "y", "z"],
    });
  });

  it("never mutates the input state (each fold returns a fresh object)", () => {
    const s0 = schema.init();
    const s1 = schema.reduce(s0, { tags: "a", counter: 1 });
    const s2 = schema.reduce(s1, { tags: "b" });

    // Prior states are untouched — required so a replay can re-fold from any recorded point.
    expect(s0).toEqual({ messages: [], counter: 0, tags: [] });
    expect(s1.tags).toEqual(["a"]);
    expect(s2.tags).toEqual(["a", "b"]);
    // Distinct object identities per fold step.
    expect(s1).not.toBe(s0);
    expect(s2).not.toBe(s1);
    // The append reducer did not mutate the previous array in place.
    expect(s1.tags).not.toBe(s2.tags);
  });

  it("invokes each channel reducer only with its own fully-applied prior value, never a partial state", () => {
    // Instrument a channel reducer to record exactly what `current` it is handed. If the fold
    // ever passed a partially-applied whole-state object, the recorded `current` would not
    // match the channel's own consistent prior value.
    const seen: number[] = [];
    const probe: Channel<number, number> = {
      init: () => 0,
      reduce: (current, update) => {
        seen.push(current);
        return current + update;
      },
    };
    const probed = new StateSchema({
      // A sibling channel updated in the SAME delta; if folding leaked partial state, `probe`
      // could observe a value influenced by the ordering of sibling updates. It must not.
      sibling: lastValue<string>("init"),
      probe,
    });

    let s = probed.init();
    s = probed.reduce(s, { sibling: "one", probe: 10 });
    s = probed.reduce(s, { sibling: "two", probe: 5 });

    // `probe.reduce` saw its own channel's consistent prior values only: 0 then 10.
    expect(seen).toEqual([0, 10]);
    expect(s.probe).toBe(15);
    expect(s.sibling).toBe("two");
  });

  it("leaves channels absent from a delta unchanged", () => {
    let s = schema.init();
    s = schema.reduce(s, { counter: 7 });
    // messages and tags were not in the delta → untouched initial values.
    expect(s).toEqual({ messages: [], counter: 7, tags: [] });
  });

  it("ignores unknown channel keys in a delta rather than corrupting state", () => {
    let s = schema.init();
    // A stray key must not appear in state nor throw.
    s = schema.reduce(s, { bogus: 99, counter: 3 } as never);
    expect(s).toEqual({ messages: [], counter: 3, tags: [] });
    expect((s as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("treats an undefined delta as a no-op (returns the same state)", () => {
    const s0 = schema.init();
    const s1 = schema.reduce(s0, undefined);
    expect(s1).toBe(s0);
  });
});
