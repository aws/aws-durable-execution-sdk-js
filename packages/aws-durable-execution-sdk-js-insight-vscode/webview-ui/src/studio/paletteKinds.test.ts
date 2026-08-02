import { KINDS, paletteKinds } from "./constants";

/**
 * `dagContainer` is the only way to author dag tasks from the palette, and dag
 * codegen targets a runtime the SDK does not implement, so offering it by default
 * let a user drag in a node that made the workflow undeployable.
 */
describe("paletteKinds", () => {
  it("hides dagContainer by default", () => {
    expect(paletteKinds(false)).not.toContain("dagContainer");
  });

  it("offers it when dag mode is enabled", () => {
    expect(paletteKinds(true)).toContain("dagContainer");
    expect(paletteKinds(true)).toEqual(KINDS);
  });

  it("hides nothing else", () => {
    const hidden = KINDS.filter((k) => !paletteKinds(false).includes(k));
    expect(hidden).toEqual(["dagContainer"]);
  });
});
