import {
  TRIGGER_RULES,
  type DagCompletionConfigSpec,
  type DagConfigSpec,
  type TriggerRule,
} from "./dag";

describe("TRIGGER_RULES", () => {
  it("contains exactly the six SDK trigger rules", () => {
    expect([...TRIGGER_RULES]).toEqual([
      "ALL_SUCCESS",
      "ALL_FAILED",
      "ALL_DONE",
      "ANY_SUCCESS",
      "ANY_FAILED",
      "NONE_FAILED",
    ]);
    expect(TRIGGER_RULES).toHaveLength(6);
  });

  it("has ALL_SUCCESS first (the default)", () => {
    expect(TRIGGER_RULES[0]).toBe("ALL_SUCCESS");
  });

  it("has no duplicate members", () => {
    expect(new Set(TRIGGER_RULES).size).toBe(TRIGGER_RULES.length);
  });

  it("stays in sync with the TriggerRule union type", () => {
    // Compile-time: every runtime entry is assignable to the union, and a
    // union value is one of the runtime entries.
    const fromRuntime: TriggerRule = TRIGGER_RULES[0];
    const fromUnion: (typeof TRIGGER_RULES)[number] = "NONE_FAILED";
    expect(fromRuntime).toBe("ALL_SUCCESS");
    expect(fromUnion).toBe("NONE_FAILED");
  });
});

describe("DagConfigSpec defaults", () => {
  it("accepts an empty config (all fields optional)", () => {
    const cfg: DagConfigSpec = {};
    expect(cfg.maxConcurrency).toBeUndefined();
    expect(cfg.completionConfig).toBeUndefined();
    expect(cfg.defaultTriggerRule).toBeUndefined();
    expect(cfg.nesting).toBeUndefined();
  });

  it("accepts the threshold completion form", () => {
    const cc: DagCompletionConfigSpec = {
      minSuccessful: 2,
      toleratedFailureCount: 1,
      toleratedFailurePercentage: 25,
    };
    const cfg: DagConfigSpec = {
      maxConcurrency: 10,
      defaultTriggerRule: "NONE_FAILED",
      nesting: "FLAT",
      completionConfig: cc,
    };
    expect(cfg.completionConfig).toBe(cc);
  });

  it("accepts the custom completion form", () => {
    const cc: DagCompletionConfigSpec = {
      shouldComplete: "status.succeeded >= 3",
    };
    const cfg: DagConfigSpec = { completionConfig: cc };
    expect(
      (cfg.completionConfig as { shouldComplete: string }).shouldComplete,
    ).toBe("status.succeeded >= 3");
  });
});
