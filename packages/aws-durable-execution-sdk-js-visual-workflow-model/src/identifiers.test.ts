import {
  buildIdentifierMap,
  RESERVED_IDENTIFIERS,
  toIdentifier,
} from "./identifiers";

describe("toIdentifier", () => {
  it("sanitizes names to safe identifiers", () => {
    expect(toIdentifier("StepA")).toBe("StepA");
    expect(toIdentifier("my step")).toBe("my_step");
    expect(toIdentifier("my-step")).toBe("my_step");
    expect(toIdentifier("1st thing")).toBe("_1st_thing");
    expect(toIdentifier("")).toBe("node");
    expect(toIdentifier("a.b.c")).toBe("a_b_c");
  });
});

describe("buildIdentifierMap", () => {
  it("maps operation nodes and skips start/end", () => {
    const map = buildIdentifierMap([
      { id: "n0", kind: "start", name: "start" },
      { id: "n1", kind: "step", name: "my step" },
      { id: "n2", kind: "end", name: "end" },
    ]);
    expect(map.get("n1")).toBe("my_step");
    expect(map.has("n0")).toBe(false);
    expect(map.has("n2")).toBe(false);
  });

  it("throws on reserved identifiers", () => {
    expect(() =>
      buildIdentifierMap([{ id: "n1", kind: "step", name: "return" }]),
    ).toThrow(/reserved identifier/);
  });

  it("throws on identifier collisions", () => {
    expect(() =>
      buildIdentifierMap([
        { id: "n1", kind: "step", name: "my step" },
        { id: "n2", kind: "step", name: "my-step" },
      ]),
    ).toThrow(/both map to the identifier/);
  });

  it("reserves runtime + keyword identifiers", () => {
    expect(RESERVED_IDENTIFIERS.has("event")).toBe(true);
    expect(RESERVED_IDENTIFIERS.has("return")).toBe(true);
  });
});
