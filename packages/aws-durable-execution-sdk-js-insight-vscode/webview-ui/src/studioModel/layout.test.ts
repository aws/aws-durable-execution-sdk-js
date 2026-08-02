import { autoLayout } from "./layout";
import { parseWorkflow } from "./model";

const yOf = (wf: ReturnType<typeof parseWorkflow>, id: string) =>
  wf.nodes.find((n) => n.id === id)!.position.y;
const xOf = (wf: ReturnType<typeof parseWorkflow>, id: string) =>
  wf.nodes.find((n) => n.id === id)!.position.x;

describe("autoLayout", () => {
  it("stacks a linear chain top-to-bottom", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: "b", kind: "step", name: "step2" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    });
    const laid = autoLayout(wf);
    expect(yOf(laid, "s")).toBeLessThan(yOf(laid, "a"));
    expect(yOf(laid, "a")).toBeLessThan(yOf(laid, "b"));
  });

  it("ranks an error-route target below its parent (not above)", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: "h", kind: "step", name: "handler" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    });
    const laid = autoLayout(wf);
    expect(yOf(laid, "h")).toBeGreaterThan(yOf(laid, "a"));
  });

  it("flows a linear chain left-to-right in LR mode (rank on x, aligned y)", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: "b", kind: "step", name: "step2" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    });
    const laid = autoLayout(wf, "LR");
    // Ranks advance along x, not y.
    expect(xOf(laid, "s")).toBeLessThan(xOf(laid, "a"));
    expect(xOf(laid, "a")).toBeLessThan(xOf(laid, "b"));
    // A single chain shares one row (same y).
    expect(yOf(laid, "s")).toBe(yOf(laid, "b"));
  });

  it("centers a lone child on the shared spine at cross-coordinate 0", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    });
    const laid = autoLayout(wf);
    // TB: cross-axis is x. A single node per rank sits exactly at x=0 —
    // independent of viewport size, so saved positions don't drift with
    // whatever window happened to be open (see frameCentered).
    expect(xOf(laid, "s")).toBe(0);
    expect(xOf(laid, "a")).toBe(0);
  });

  it("splits two siblings symmetrically around 0 under one parent", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: "b", kind: "step", name: "step2" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "s", target: "b" },
      ],
    });
    const laid = autoLayout(wf);
    const xa = xOf(laid, "a");
    const xb = xOf(laid, "b");
    // Symmetric around the spine at 0 — one negative, one positive, equal
    // magnitude — exactly "node1 at +N, node2 at -N" around the parent.
    expect(xa + xb).toBe(0);
    expect(Math.abs(xa)).toBeGreaterThan(0);
    expect(xa).not.toBe(xb);
  });
});
