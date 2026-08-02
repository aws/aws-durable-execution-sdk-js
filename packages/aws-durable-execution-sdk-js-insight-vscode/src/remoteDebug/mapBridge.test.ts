/*
 * Tests for the .dar.ts ↔ bundle line bridge. The fixture is a REAL source
 * map built with source-map's own SourceMapGenerator (not a hand-written
 * JSON blob) so the mappings go through the same encoder the library's
 * consumer decodes — the closest thing to the esbuild-produced map
 * deploy.ts writes, without running esbuild in the test.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceMapGenerator } from "source-map";
import { loadMapBridge, type MapBridge } from "./mapBridge";

/**
 * Builds a map with the shapes the bridge must handle:
 * - dar line 2 generated from TWO bundle lines (10 and 12) — the esbuild
 *   statement-splitting case that makes darLineToBundleLines plural.
 * - dar line 3 → bundle line 15 (with a second mapping on the same
 *   generated line to exercise dedupe).
 * - dar line 7 → bundle line 25, leaving lines 4–6 UNMAPPED: a gap BETWEEN
 *   mapped lines, which is what a node that emits no code (a `start` node's
 *   declaration line) or a blank/comment line actually looks like.
 * - a NON-dar source ('runtime/helpers.ts') → bundle line 20, for the
 *   null-on-foreign-source direction.
 */
function buildFixtureMap(darSource: string): string {
  const gen = new SourceMapGenerator({ file: "index.js" });
  gen.addMapping({
    source: darSource,
    original: { line: 2, column: 0 },
    generated: { line: 10, column: 0 },
  });
  gen.addMapping({
    source: darSource,
    original: { line: 2, column: 4 },
    generated: { line: 12, column: 0 },
  });
  gen.addMapping({
    source: darSource,
    original: { line: 3, column: 0 },
    generated: { line: 15, column: 0 },
  });
  // Same generated line twice (different columns) — result must dedupe.
  gen.addMapping({
    source: darSource,
    original: { line: 3, column: 8 },
    generated: { line: 15, column: 20 },
  });
  gen.addMapping({
    source: darSource,
    original: { line: 7, column: 0 },
    generated: { line: 25, column: 0 },
  });
  gen.addMapping({
    source: "runtime/helpers.ts",
    original: { line: 1, column: 0 },
    generated: { line: 20, column: 0 },
  });
  return gen.toString();
}

describe("loadMapBridge", () => {
  let dir: string;
  let bridge: MapBridge | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "map-bridge-test-"));
  });

  afterEach(() => {
    bridge?.dispose();
    bridge = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function load(darSource: string): Promise<MapBridge> {
    const mapPath = join(dir, "index.js.map");
    writeFileSync(mapPath, buildFixtureMap(darSource), "utf-8");
    bridge = await loadMapBridge(mapPath);
    return bridge;
  }

  it("finds the .dar.ts source by suffix when it is a bare filename", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.darSource).toBe("fixture.dar.ts");
  });

  it("finds the .dar.ts source by suffix when it is an absolute path", async () => {
    // deploy.ts records the user's REAL saved file path when it can vouch
    // for it (darSourceAbsolutePath) — the bridge must match by suffix, not
    // equality with a bare name.
    const abs = "/Users/someone/workflows/fixture.dar.ts";
    const b = await load(abs);
    expect(b.darSource).toBe(abs);
    // And mappings still resolve against that exact source string.
    expect(b.darLineToBundleLines(3)).toEqual([15]);
  });

  it("throws when the map has no .dar.ts source", async () => {
    const gen = new SourceMapGenerator({ file: "index.js" });
    gen.addMapping({
      source: "plain.ts",
      original: { line: 1, column: 0 },
      generated: { line: 1, column: 0 },
    });
    const mapPath = join(dir, "no-dar.js.map");
    writeFileSync(mapPath, gen.toString(), "utf-8");
    await expect(loadMapBridge(mapPath)).rejects.toThrow(/no \.dar\.ts source/);
  });

  it("maps a dar line generated from two bundle lines to both, sorted", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.darLineToBundleLines(2)).toEqual([10, 12]);
  });

  it("dedupes multiple mappings on the same generated line", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.darLineToBundleLines(3)).toEqual([15]);
  });

  it("returns [] for a dar line that generated no code", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.darLineToBundleLines(999)).toEqual([]);
  });

  it("returns [] for an unmapped dar line BETWEEN mapped ones instead of a neighbour's lines", async () => {
    // The bug this guards: source-map's allGeneratedPositionsFor is fuzzy —
    // asked about line 5 it answered with line 7's positions. A breakpoint on
    // a node that emits no code (a `start` node) therefore reported itself as
    // bound and then paused inside a COMPLETELY DIFFERENT node, which also
    // made the canvas glow the wrong node.
    const b = await load("fixture.dar.ts");
    expect(b.darLineToBundleLines(4)).toEqual([]);
    expect(b.darLineToBundleLines(5)).toEqual([]);
    expect(b.darLineToBundleLines(6)).toEqual([]);
    // …while the real mapped lines on either side are unaffected.
    expect(b.darLineToBundleLines(3)).toEqual([15]);
    expect(b.darLineToBundleLines(7)).toEqual([25]);
  });

  it("returns [] for a dar line before the first mapping", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.darLineToBundleLines(1)).toEqual([]);
  });

  it("maps bundle lines back to their dar line", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.bundleLineToDarLine(10)).toBe(2);
    expect(b.bundleLineToDarLine(12)).toBe(2);
    expect(b.bundleLineToDarLine(15)).toBe(3);
  });

  it("returns null for a bundle line mapping to a non-dar source", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.bundleLineToDarLine(20)).toBeNull(); // runtime/helpers.ts
  });

  it("returns null for an unmapped bundle line", async () => {
    const b = await load("fixture.dar.ts");
    expect(b.bundleLineToDarLine(9999)).toBeNull();
  });

  it("dispose() is idempotent", async () => {
    const b = await load("fixture.dar.ts");
    b.dispose();
    expect(() => b.dispose()).not.toThrow();
    bridge = undefined; // Already disposed — keep afterEach from re-running it.
  });
});
