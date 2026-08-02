import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { parseWorkflow } from "@aws/durable-execution-sdk-js-cdk";
import { bundleWorkflowZip } from "./deploy";

const DAR_JSON = `{
  "darVersion": "1.0",
  "name": "DeployMapFixture",
  "dependencyMode": "linear",
  "nodes": [
    { "id": "start", "kind": "start", "name": "Start" },
    {
      "id": "Do_Work",
      "kind": "step",
      "name": "Do Work",
      "terminal": true,
      "code": "return { ok: true };"
    }
  ],
  "edges": [
    { "id": "e0", "source": "start", "target": "Do_Work" }
  ]
}`;

// The .dar.ts text corresponding to DAR_JSON (see docs/dar-ts-specification.md
// — this is now the always-embedded deploy artifact format, not just a
// debug-only concern).
const DAR_TS = `async function Do_Work() {
  return { ok: true };
}

export const workflow = {
  darVersion: "1.0",
  name: "DeployMapFixture",
  dependencyMode: "linear",
  nodes: [
    { id: "start", kind: "start", name: "Start" },
    { id: "Do_Work", kind: "step", name: "Do Work", terminal: true, code: Do_Work },
  ],
  edges: [{ id: "e0", source: "start", target: "Do_Work" }],
};

export const meta = { layout: { direction: "TB", positions: {} } };
`;

describe("bundleWorkflowZip .dar.ts embedding + debug source-map wiring", () => {
  const workflow = parseWorkflow(JSON.parse(DAR_JSON));

  it("always embeds workflow.dar.ts (not workflow.dar.json) even without debug info", async () => {
    const zip = await bundleWorkflowZip(workflow, DAR_TS);
    const entries = new AdmZip(zip).getEntries().map((e) => e.entryName);
    expect(entries).toEqual(
      expect.arrayContaining(["index.js", "workflow.dar.ts"]),
    );
    expect(entries).not.toContain("workflow.dar.json");
    expect(entries).not.toContain("index.js.map");
    const indexJs = new AdmZip(zip)
      .getEntry("index.js")
      ?.getData()
      .toString("utf-8");
    expect(indexJs).not.toContain("sourceMappingURL");
    const embeddedDarTs = new AdmZip(zip)
      .getEntry("workflow.dar.ts")
      ?.getData()
      .toString("utf-8");
    expect(embeddedDarTs).toBe(DAR_TS);
  });

  it("persists a real .js/.js.map pair to debugOutDir and embeds index.js.map in the zip when debug is requested", async () => {
    const outDir = join(tmpdir(), `wf-debug-test-${Date.now()}`);
    try {
      const zip = await bundleWorkflowZip(workflow, DAR_TS, {
        outDir,
        darSourceFileName: "deployMapFixture.dar.ts",
      });

      // The zip itself is self-describing even if outDir later disappears.
      const zipEntries = new AdmZip(zip).getEntries().map((e) => e.entryName);
      expect(zipEntries).toEqual(
        expect.arrayContaining(["index.js", "index.js.map", "workflow.dar.ts"]),
      );
      const indexJsInZip = new AdmZip(zip)
        .getEntry("index.js")
        ?.getData()
        .toString("utf-8");
      expect(indexJsInZip).toContain("//# sourceMappingURL=index.js.map");

      // Stable, persistent debug directory has everything a debugger needs.
      expect(existsSync(join(outDir, "index.js"))).toBe(true);
      expect(existsSync(join(outDir, "index.js.map"))).toBe(true);
      expect(existsSync(join(outDir, "handler.ts"))).toBe(true);
      expect(existsSync(join(outDir, "handler.ts.map"))).toBe(true);
      expect(existsSync(join(outDir, "deployMapFixture.dar.ts"))).toBe(true);
      expect(
        readFileSync(join(outDir, "deployMapFixture.dar.ts"), "utf-8"),
      ).toBe(DAR_TS);

      // The map chains straight from index.js to the .dar.ts source for OUR
      // generated code specifically. It legitimately also includes the
      // bundled @aws/durable-execution-sdk-js package's own source files as
      // additional `sources` entries (esbuild bundles the whole reachable
      // module graph, and each module's positions still resolve to itself) —
      // so this checks for inclusion of our .dar.ts source, not exclusivity.
      //
      // The .dar.ts entry must be the CLEAN BARE FILENAME, not a path into
      // the ephemeral temp dir esbuild actually built in — `bundleWorkflowZip`
      // rewrites this one entry after esbuild runs specifically so the map
      // persisted to `debugOutDir` never depends on the temp dir still
      // existing (see that function's own doc comment for why esbuild's raw
      // output can't be trusted here as-is).
      const map = JSON.parse(
        readFileSync(join(outDir, "index.js.map"), "utf-8"),
      );
      expect(map.sources).toContain("deployMapFixture.dar.ts");
      const darIdx = map.sources.indexOf("deployMapFixture.dar.ts");
      expect(map.sourcesContent?.[darIdx]).toBe(DAR_TS);
      // Confirm the workflow's own generated line ("return { ok: true };")
      // actually resolves to the .dar.ts source, not just that the source is
      // PRESENT somewhere in the map (the real thing we care about) — and
      // that it lands on the REAL line inside Do_Work's function body
      // (statement-level granularity, not just "the node starts here").
      const { SourceMapConsumer } = await import("source-map");
      const consumer = await new SourceMapConsumer(map);
      const bundledJs = readFileSync(join(outDir, "index.js"), "utf-8");
      const lineIdx = bundledJs
        .split("\n")
        .findIndex((l) => l.includes("ok: true"));
      expect(lineIdx).toBeGreaterThan(-1);
      const pos = consumer.originalPositionFor({
        line: lineIdx + 1,
        column: 0,
      });
      expect(pos.source).toBe("deployMapFixture.dar.ts");
      expect(pos.line).toBe(2); // Do_Work's body: "  return { ok: true };"
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("records darSourceAbsolutePath (the user's real saved file) as the map's source when provided", async () => {
    const outDir = join(tmpdir(), `wf-debug-abs-test-${Date.now()}`);
    // Simulates the workflow's real saved .dar.ts living somewhere entirely
    // unrelated to outDir — the path Workflow Studio's webview gutter
    // registers breakpoints against (see extension.ts's onToggleBreakpoint).
    const savedPath = join(tmpdir(), `wf-saved-${Date.now()}`, "my.dar.ts");
    try {
      await bundleWorkflowZip(workflow, DAR_TS, {
        outDir,
        darSourceFileName: "deployMapFixture.dar.ts",
        darSourceAbsolutePath: savedPath,
      });
      const map = JSON.parse(
        readFileSync(join(outDir, "index.js.map"), "utf-8"),
      );
      // The bare-filename entry is REPLACED by the absolute path (one entry,
      // not both) so a debugger resolves the mapped source to the user's own
      // file — where the webview's breakpoints actually live.
      expect(map.sources).toContain(savedPath);
      expect(map.sources).not.toContain("deployMapFixture.dar.ts");
      // Positions still resolve there with statement-level granularity.
      const { SourceMapConsumer } = await import("source-map");
      const consumer = await new SourceMapConsumer(map);
      const bundledJs = readFileSync(join(outDir, "index.js"), "utf-8");
      const lineIdx = bundledJs
        .split("\n")
        .findIndex((l) => l.includes("ok: true"));
      const pos = consumer.originalPositionFor({
        line: lineIdx + 1,
        column: 0,
      });
      expect(pos.source).toBe(savedPath);
      expect(pos.line).toBe(2);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(join(savedPath, ".."), { recursive: true, force: true });
    }
  });
});
