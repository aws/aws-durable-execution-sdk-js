import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireLambdaFunctionName } from "./deploy";

/**
 * `functionName` is used as a PATH SEGMENT (the debug output directory) and as a
 * filename (`${functionName}.dar.ts`). `path.join` normalizes `..`, so an unchecked
 * name wrote outside the intended directory.
 *
 * Not just a local footgun: `deploy: { functionName, region }` is a persisted
 * `.dar.ts` field, so the name can arrive from an imported or model-generated
 * workflow rather than from the user typing it. The only prior check was
 * non-emptiness.
 */
describe("requireLambdaFunctionName", () => {
  it.each(["my-fn", "my_fn", "MyFn123", "a"])("accepts %s", (n) => {
    expect(requireLambdaFunctionName(n)).toBe(n);
  });

  it.each([
    ["parent traversal", "../../../tmp/evil"],
    ["single traversal", ".."],
    ["absolute path", "/etc/passwd"],
    ["nested path", "a/b"],
    ["windows separator", "a\\b"],
    ["dot segment", "."],
    ["empty", ""],
    ["blank", "   "],
    ["too long", "x".repeat(65)],
  ])("rejects %s", (_label, n) => {
    expect(() => requireLambdaFunctionName(n)).toThrow(
      /not a valid Lambda function name/,
    );
  });

  /**
   * Enumerating sites is what failed for the dag gate, so this asserts structurally
   * — and across BOTH hosts. The first version of this test matched only VS Code's
   * `.workflow-studio-debug`, which is why the desktop's second `WorkflowStudioDebug`
   * site stayed unvalidated: the guard and the test meant to prove the guard shared
   * the same blind spot.
   */
  const HOSTS: [string, string, RegExp][] = [
    [
      "extension.ts",
      join(__dirname, "extension.ts"),
      /\.workflow-studio-debug",\n\s*([^\n]*)/g,
    ],
    [
      "desktop host.ts",
      join(
        __dirname,
        "../../aws-durable-execution-sdk-js-insight-desktop/src/host.ts",
      ),
      /"WorkflowStudioDebug",\n\s*([^\n]*)/g,
    ],
  ];

  it.each(HOSTS)(
    "validates the name at every debug-dir site in %s",
    (_label, file, re) => {
      const src = readFileSync(file, "utf-8");
      const sites = [...src.matchAll(re)];
      // A passing-but-vacuous version of this test is the bug it exists to catch.
      expect(sites.length).toBeGreaterThan(0);
      for (const m of sites) {
        expect(m[1]).toContain("requireLambdaFunctionName");
      }
    },
  );

  it("covers every debug-dir construction in both hosts", () => {
    // Guards the guard: if a third site appears or a path constant is renamed, the
    // count changes and this fails rather than silently covering less.
    const total = HOSTS.map(
      ([, file]) =>
        [
          ...readFileSync(file, "utf-8").matchAll(
            /(?:\.workflow-studio-debug|"WorkflowStudioDebug)",/g,
          ),
        ].length,
    ).reduce((a, b) => a + b, 0);
    expect(total).toBe(4); // 2 in the extension, 2 in the desktop host
  });
});
