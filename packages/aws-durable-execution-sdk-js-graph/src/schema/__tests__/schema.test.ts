import { StateSchema, appendValue, lastValue, messagesValue } from "..";

describe("channels and reducers", () => {
  it("lastValue is last-write-wins and pure", () => {
    const ch = lastValue<number>(0);
    expect(ch.init()).toBe(0);
    expect(ch.reduce(5, 9)).toBe(9);
    // Prior value discarded, no mutation of inputs (primitives can't mutate anyway).
    expect(ch.reduce(1, 2)).toBe(2);
  });

  it("appendValue accumulates and never mutates the current array", () => {
    const ch = appendValue<string>();
    const start = ch.init();
    const next = ch.reduce(start, "a");
    expect(next).toEqual(["a"]);
    // Original untouched (purity: reducers re-run on replay).
    expect(start).toEqual([]);
    // Accepts a batch too.
    expect(ch.reduce(next, ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(next).toEqual(["a"]);
  });

  it("messagesValue behaves like an append channel", () => {
    const ch = messagesValue<{ role: string; content: string }>();
    const s = ch.reduce(ch.init(), { role: "user", content: "hi" });
    expect(s).toHaveLength(1);
  });
});

describe("StateSchema fold", () => {
  const schema = new StateSchema({
    messages: appendValue<string>(),
    count: lastValue<number>(0),
  });

  it("init applies channel defaults and folds an input delta", () => {
    expect(schema.init()).toEqual({ messages: [], count: 0 });
    expect(schema.init({ messages: "hello", count: 3 })).toEqual({
      messages: ["hello"],
      count: 3,
    });
  });

  it("ignores non-object input", () => {
    expect(schema.init("nonsense")).toEqual({ messages: [], count: 0 });
  });

  it("reduce only touches channels present in the delta and does not mutate state", () => {
    const s0 = schema.init();
    const s1 = schema.reduce(s0, { messages: "a" });
    expect(s1).toEqual({ messages: ["a"], count: 0 });
    // s0 unchanged.
    expect(s0).toEqual({ messages: [], count: 0 });

    const s2 = schema.reduce(s1, { count: 7 });
    expect(s2).toEqual({ messages: ["a"], count: 7 });
    // messages array identity carried by reference (no reducer ran for it).
    expect(s2.messages).toBe(s1.messages);
  });

  it("ignores unknown channels in a delta", () => {
    // Cast through unknown: a plain-JS caller could pass an unknown channel; the fold must
    // silently ignore it rather than corrupt state.
    const s = schema.reduce(schema.init(), {
      bogus: 1,
      count: 2,
    } as unknown as { count: number });
    expect(s).toEqual({ messages: [], count: 2 });
  });

  it("folding N deltas equals applying them sequentially (delta-fold property)", () => {
    const deltas = [
      { messages: "a" },
      { messages: ["b", "c"], count: 1 },
      { count: 2 },
      { messages: "d" },
    ];
    let folded = schema.init();
    for (const d of deltas) {
      folded = schema.reduce(folded, d);
    }
    expect(folded).toEqual({ messages: ["a", "b", "c", "d"], count: 2 });
  });
});
