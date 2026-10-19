import { runSandboxedJs } from "./sandbox";

const rows = [
  { claimtype: "auto", amount: "100" },
  { claimtype: "home", amount: "200" },
  { claimtype: "auto", amount: "50" },
];
const columns = ["claimtype", "amount"];

describe("runSandboxedJs", () => {
  it("computes over the injected rows and returns the value", async () => {
    const r = await runSandboxedJs(
      `const byType = {};
       for (const row of rows) byType[row.claimtype] = (byType[row.claimtype] || 0) + Number(row.amount);
       return byType;`,
      { rows, columns },
    );
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ auto: 150, home: 200 });
  });

  it("exposes columns to the code", async () => {
    const r = await runSandboxedJs(`return columns;`, { rows, columns });
    expect(r.value).toEqual(["claimtype", "amount"]);
  });

  it("has NO host access (no require/process/fetch)", async () => {
    const r = await runSandboxedJs(
      `return { require: typeof require, process: typeof process, fetch: typeof fetch };`,
      { rows, columns },
    );
    expect(r.value).toEqual({
      require: "undefined",
      process: "undefined",
      fetch: "undefined",
    });
  });

  it("cannot escape to the filesystem", async () => {
    const r = await runSandboxedJs(
      `return require('fs').readFileSync('/etc/passwd', 'utf8');`,
      { rows, columns },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/require/i);
  });

  it("is interrupted by the timeout on an infinite loop", async () => {
    const start = Date.now();
    const r = await runSandboxedJs(
      `while (true) {}`,
      { rows, columns },
      {
        timeoutMs: 300,
      },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/interrupt/i);
    // Should stop promptly, not hang.
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("reports runtime errors instead of throwing", async () => {
    const r = await runSandboxedJs(`return foo.bar;`, { rows, columns });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
  });
});
