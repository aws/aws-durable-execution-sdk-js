import {
  resolveRootPreserveChildDepth,
  validateChildOperationsDepth,
} from "./child-operations-depth";

describe("validateChildOperationsDepth", () => {
  it("accepts undefined, 0, positive integers, and Infinity (no error)", () => {
    expect(validateChildOperationsDepth(undefined)).toBeUndefined();
    expect(validateChildOperationsDepth(0)).toBeUndefined();
    expect(validateChildOperationsDepth(1)).toBeUndefined();
    expect(validateChildOperationsDepth(5)).toBeUndefined();
    expect(validateChildOperationsDepth(Infinity)).toBeUndefined();
  });

  it("rejects negative, fractional, NaN, and non-number values", () => {
    expect(validateChildOperationsDepth(-1)).toMatch(/non-negative integer/);
    expect(validateChildOperationsDepth(1.5)).toMatch(/non-negative integer/);
    expect(validateChildOperationsDepth(NaN)).toMatch(/non-negative integer/);
    expect(validateChildOperationsDepth("2" as unknown as number)).toMatch(
      /non-negative integer/,
    );
  });
});

describe("resolveRootPreserveChildDepth", () => {
  it("returns 0 (off) for undefined and 0", () => {
    expect(resolveRootPreserveChildDepth(undefined)).toBe(0);
    expect(resolveRootPreserveChildDepth(0)).toBe(0);
  });

  it("seeds the root at depth + 1 for positive integers", () => {
    // depth 1 (children of top-level contexts) => root budget 2, so a
    // top-level context ends up with budget 1 (preserves its children).
    expect(resolveRootPreserveChildDepth(1)).toBe(2);
    expect(resolveRootPreserveChildDepth(2)).toBe(3);
    expect(resolveRootPreserveChildDepth(5)).toBe(6);
  });

  it("passes through Infinity", () => {
    expect(resolveRootPreserveChildDepth(Infinity)).toBe(Infinity);
  });
});
