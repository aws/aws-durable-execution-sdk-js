import { tickPath, nodePath, localPath, hashPath } from "../operation-path";

describe("structural path construction (§6 fallback)", () => {
  it("is a pure function of (tick, nodeName, localName)", () => {
    expect(tickPath(0)).toBe("t0");
    expect(tickPath(3)).toBe("t3");
    expect(nodePath(1, "model")).toBe("t1/model");
    expect(localPath(2, "tools", "approval")).toBe("t2/tools/approval");
  });

  it("produces identical paths on repeated calls (replay-stable)", () => {
    expect(localPath(2, "model", "invoke")).toBe(
      localPath(2, "model", "invoke"),
    );
  });

  it("distinguishes the same node across ticks (cycles, §5.3)", () => {
    expect(nodePath(0, "model")).not.toBe(nodePath(2, "model"));
  });

  it("hashPath is a stable 16-hex token", () => {
    const h = hashPath("t2/model/invoke");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashPath("t2/model/invoke")).toBe(h);
    expect(hashPath("t2/model/other")).not.toBe(h);
  });
});
