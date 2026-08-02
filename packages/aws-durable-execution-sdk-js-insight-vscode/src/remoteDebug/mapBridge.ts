/**
 * Line translation between a debug deploy's bundled `index.js` and the
 * workflow's own `.dar.ts` source, via the `index.js.map` that
 * `deploy.ts`'s `bundleWorkflowZip` writes to the debug out-dir (see that
 * module for how the chained esbuild map is produced and why its `.dar.ts`
 * `sources` entry may be either a bare filename or the user's real
 * absolute path — this bridge must handle both, hence suffix matching).
 *
 * The two directions serve the two halves of a remote debug session:
 * - `.dar.ts` line → bundle line(s): where to SET a breakpoint
 *   (`Debugger.setBreakpointByUrl` against `/var/task/index.js`). One
 *   source line regularly maps to SEVERAL generated lines (esbuild splits
 *   statements), so this returns all of them.
 * - bundle line → `.dar.ts` line: where a PAUSE landed, for gutter
 *   highlighting. Pauses inside runtime/SDK code map to non-`.dar.ts`
 *   sources (or nothing) — those return null so the caller can step/resume
 *   past them instead of showing a bogus location.
 *
 * NO `vscode` imports (same rule as the rest of `remoteDebug/`): runs in
 * the extension host, plain Node, and the Electron main process.
 *
 * source-map@0.7 specifics that shape the code:
 * - Construction is async (`await new SourceMapConsumer(raw)`) — the 0.7
 *   line parses mappings in wasm.
 * - Consumers hold wasm-side memory that the GC can't see; every consumer
 *   MUST be `.destroy()`ed, which is what {@link MapBridge.dispose} is for.
 */

import { readFileSync } from "node:fs";
import {
  SourceMapConsumer,
  type BasicSourceMapConsumer,
  type IndexedSourceMapConsumer,
} from "source-map";

export interface MapBridge {
  /** The map's `sources` entry for the workflow's `.dar.ts` file — bare
   * filename or absolute path depending on how the deploy was made (see
   * module doc comment). Matched by `.dar.ts` suffix. */
  darSource: string;
  /**
   * All bundled `index.js` lines generated from the given 1-based `.dar.ts`
   * line, deduped and ascending, 1-based. EXACT: empty when the line
   * produced no code (a blank/comment line, or a node that emits nothing
   * such as `start`), never the nearest other line's positions — see the
   * index built in {@link loadMapBridge} for why that distinction matters.
   */
  darLineToBundleLines(line: number): number[];
  /**
   * The 1-based `.dar.ts` line a 1-based bundle line originated from, or
   * null when it maps to a non-`.dar.ts` source (SDK/runtime code) or to
   * nothing at all.
   */
  bundleLineToDarLine(line: number): number | null;
  /** Releases the consumer's wasm-side memory. The bridge is unusable
   * afterwards. */
  dispose(): void;
}

/**
 * Loads `index.js.map` from disk and wraps it in a {@link MapBridge}.
 * Throws when the map has no `.dar.ts` source — that means the deploy was
 * made without debug info and there is nothing to bridge to.
 */
export async function loadMapBridge(mapPath: string): Promise<MapBridge> {
  const raw = readFileSync(mapPath, "utf-8");
  const consumer: BasicSourceMapConsumer | IndexedSourceMapConsumer =
    await new SourceMapConsumer(raw);

  // Suffix match, not equality: deploy.ts records either the bare
  // `<fn>.dar.ts` filename or the user's real absolute saved path in
  // `sources` (see DeployOptions.darSourceAbsolutePath). Taken from the
  // CONSUMER's sources (not the raw JSON) so the exact string handed back
  // to allGeneratedPositionsFor matches the consumer's own normalization.
  const darSource = consumer.sources.find((s) => s.endsWith(".dar.ts"));
  if (!darSource) {
    consumer.destroy();
    throw new Error(
      `${mapPath} has no .dar.ts source — was the function deployed with debug info?`,
    );
  }

  let disposed = false;

  // EXACT forward index, built once: `.dar.ts` line -> the generated bundle
  // lines that line actually produced.
  //
  // Why an index instead of `allGeneratedPositionsFor`: that API is FUZZY.
  // Asked for an original line with no mapping of its own, it answers with
  // the positions of the nearest mapped line instead of nothing — so a
  // breakpoint on a line that generates no code (a `start` node's
  // declaration line, a blank line, a comment) came back "bound" and then
  // paused at a COMPLETELY DIFFERENT node, which also made the canvas glow
  // the wrong node. Walking `eachMapping` and keying on `originalLine`
  // exactly is the only way to keep this function's contract ("empty when
  // the line produced no code") actually true.
  const forward = new Map<number, number[]>();
  consumer.eachMapping((m) => {
    if (m.source !== darSource) return;
    const existing = forward.get(m.originalLine);
    if (existing === undefined) {
      forward.set(m.originalLine, [m.generatedLine]);
    } else if (!existing.includes(m.generatedLine)) {
      existing.push(m.generatedLine);
    }
  });
  for (const lines of forward.values()) {
    lines.sort((a, b) => a - b);
  }

  return {
    darSource,

    darLineToBundleLines(line: number): number[] {
      return [...(forward.get(line) ?? [])];
    },

    bundleLineToDarLine(line: number): number | null {
      const pos = consumer.originalPositionFor({ line, column: 0 });
      if (pos.source === null || pos.line === null) {
        return null;
      }
      // Pauses in SDK/runtime code map to some other source — the caller
      // should treat those as "not the user's code", hence null.
      return pos.source.endsWith(".dar.ts") ? pos.line : null;
    },

    dispose(): void {
      if (disposed) {
        return; // destroy() twice aborts in the wasm binding — guard it.
      }
      disposed = true;
      consumer.destroy();
    },
  };
}
