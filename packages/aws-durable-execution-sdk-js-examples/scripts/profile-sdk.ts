/**
 * Performance Profiling Script for AWS Durable Execution SDK (Core SDK Focus)
 *
 * Similar to Chrome's "Analyze runtime performance" tab, this script runs
 * integration tests against the LOCAL SDK SOURCE (not bundled dist) so the
 * CPU profile shows individual SDK functions in their original files.
 *
 * It uses the same approach as `copy-sdk-source.js` + jest moduleNameMapper
 * to resolve `@aws/durable-execution-sdk-js` to the TypeScript source, giving
 * full function-level visibility in the generated .cpuprofile.
 *
 * Usage:
 *   # CPU profile with core SDK source visibility
 *   npx tsx scripts/profile-sdk.ts --cpu
 *
 *   # Memory/heap analysis
 *   npx tsx scripts/profile-sdk.ts --heap
 *
 *   # Target specific examples
 *   npx tsx scripts/profile-sdk.ts --cpu --examples comprehensive-operations,map/large-scale
 *
 *   # More iterations for stable numbers
 *   npx tsx scripts/profile-sdk.ts --cpu --iterations 10
 *
 * Output (in ./profiling-output/):
 *   ├── sdk-cpu-<timestamp>.cpuprofile   → Chrome DevTools Performance tab
 *   ├── sdk-heap-before-<timestamp>.heapsnapshot
 *   ├── sdk-heap-after-<timestamp>.heapsnapshot
 *   └── sdk-timing-report-<timestamp>.json
 *
 * The .cpuprofile will show individual SDK source files like:
 *   - src/handlers/step-handler/step-handler.ts
 *   - src/utils/checkpoint/checkpoint-manager.ts
 *   - src/utils/serdes/serdes.ts
 *   - src/with-durable-execution.ts
 */

import { Session } from "node:inspector/promises";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
  cpSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Argument Parsing ───────────────────────────────────────────────────────

interface ProfileOptions {
  cpu: boolean;
  heap: boolean;
  iterations: number;
  examples: string[] | null;
  outputDir: string;
}

function parseArgs(): ProfileOptions {
  const args = process.argv.slice(2);
  const opts: ProfileOptions = {
    cpu: false,
    heap: false,
    iterations: 3,
    examples: null,
    outputDir: path.resolve(__dirname, "..", "profiling-output"),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cpu":
        opts.cpu = true;
        break;
      case "--heap":
        opts.heap = true;
        break;
      case "--iterations": {
        const parsed = parseInt(args[++i], 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          console.error(
            `Invalid --iterations value: "${args[i]}" (must be a positive integer)`,
          );
          process.exit(1);
        }
        opts.iterations = parsed;
        break;
      }
      case "--examples":
        opts.examples = args[++i].split(",").map((e) => e.trim());
        break;
      case "--output":
        opts.outputDir = path.resolve(args[++i]);
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  if (!opts.cpu && !opts.heap) {
    opts.cpu = true;
  }

  return opts;
}

function printHelp() {
  console.log(`
Performance Profiling for AWS Durable Execution SDK (Core SDK Source)

Usage:
  npx tsx scripts/profile-sdk.ts [options]

Options:
  --cpu              Collect CPU profile (Chrome DevTools compatible)
  --heap             Collect heap snapshots (before/after)
  --iterations N     Run each example N times (default: 3)
  --examples A,B,C   Comma-separated example names (default: all)
  --output DIR       Output directory (default: ./profiling-output)
  --help             Show this help

How it works:
  1. Copies core SDK source to src/dur-sdk/ (same as coverage scripts)
  2. Registers a module resolver so imports resolve to source TS
  3. Runs examples with V8 Profiler attached
  4. Produces .cpuprofile with full SDK function attribution

Examples:
  # Profile the comprehensive test (shows all SDK primitives)
  npx tsx scripts/profile-sdk.ts --cpu --examples comprehensive-operations

  # Profile map at scale to find serialization bottlenecks
  npx tsx scripts/profile-sdk.ts --cpu --examples map/large-scale --iterations 5

  # Full memory analysis
  npx tsx scripts/profile-sdk.ts --heap --iterations 5
`);
}

// ─── SDK Source Setup ───────────────────────────────────────────────────────

function setupSdkSource(): string {
  const sdkSourcePath = path.resolve(
    __dirname,
    "../../aws-durable-execution-sdk-js/src",
  );
  const targetPath = path.resolve(__dirname, "../src/dur-sdk");

  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }

  cpSync(sdkSourcePath, targetPath, { recursive: true });
  console.log(`✓ Copied SDK source to ${targetPath}`);
  return targetPath;
}

function cleanupSdkSource() {
  const targetPath = path.resolve(__dirname, "../src/dur-sdk");
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
    console.log(`✓ Cleaned up SDK source copy`);
  }
}

// ─── Example Discovery ──────────────────────────────────────────────────────

interface ExampleEntry {
  name: string;
  handlerPath: string;
}

function discoverExamples(filter: string[] | null): ExampleEntry[] {
  const examplesDir = path.resolve(__dirname, "..", "src", "examples");
  const entries: ExampleEntry[] = [];

  function walk(dir: string, prefix: string = "") {
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const subdir = path.join(dir, item.name);
        const exampleName = prefix ? `${prefix}/${item.name}` : item.name;

        // Convention 1: handler named same as directory
        const handlerSameName = path.join(subdir, `${item.name}.ts`);
        // Convention 2: handler with parent prefix (e.g., map/basic/map-basic.ts)
        const parentDir = path.basename(dir);
        const handlerWithPrefix = path.join(
          subdir,
          `${parentDir}-${item.name}.ts`,
        );

        if (existsSync(handlerSameName)) {
          entries.push({ name: exampleName, handlerPath: handlerSameName });
        } else if (existsSync(handlerWithPrefix)) {
          entries.push({ name: exampleName, handlerPath: handlerWithPrefix });
        }

        walk(subdir, exampleName);
      }
    }
  }

  walk(examplesDir);

  if (filter) {
    return entries.filter((e) =>
      filter.some((f) => e.name === f || e.name.includes(f)),
    );
  }

  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface TimingResult {
  example: string;
  iteration: number;
  totalMs: number;
  heapUsedBefore: number;
  heapUsedAfter: number;
  heapDelta: number;
  rss: number;
}

interface ExampleSummary {
  example: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  avgHeapDeltaBytes: number;
  avgRssBytes: number;
  iterations: number;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function summarize(results: TimingResult[]): ExampleSummary[] {
  const grouped = new Map<string, TimingResult[]>();
  for (const r of results) {
    const group = grouped.get(r.example) || [];
    group.push(r);
    grouped.set(r.example, group);
  }

  const summaries: ExampleSummary[] = [];
  for (const [example, runs] of grouped) {
    const times = runs.map((r) => r.totalMs).sort((a, b) => a - b);
    summaries.push({
      example,
      avgMs: times.reduce((a, b) => a + b, 0) / times.length,
      minMs: times[0],
      maxMs: times[times.length - 1],
      p50Ms: percentile(times, 50),
      p95Ms: percentile(times, 95),
      avgHeapDeltaBytes:
        runs.reduce((a, r) => a + r.heapDelta, 0) / runs.length,
      avgRssBytes: runs.reduce((a, r) => a + r.rss, 0) / runs.length,
      iterations: runs.length,
    });
  }

  return summaries.sort((a, b) => b.avgMs - a.avgMs);
}

function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes.toFixed(0)}B`;
  if (Math.abs(bytes) < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function takeHeapSnapshot(session: Session): Promise<string> {
  const chunks: string[] = [];
  session.on("HeapProfiler.addHeapSnapshotChunk", (m: any) => {
    chunks.push(m.params.chunk);
  });
  await session.post("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
  });
  return chunks.join("");
}

// ─── Main Profiling Logic ───────────────────────────────────────────────────

async function runProfiling() {
  const opts = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  mkdirSync(opts.outputDir, { recursive: true });

  console.log("🔍 SDK Performance Profiler — Core SDK Source Visibility");
  console.log("═".repeat(60));
  console.log(`  CPU profiling:  ${opts.cpu ? "✅" : "❌"}`);
  console.log(`  Heap snapshots: ${opts.heap ? "✅" : "❌"}`);
  console.log(`  Iterations:     ${opts.iterations}`);
  console.log(`  Output:         ${opts.outputDir}`);
  console.log("");

  // Step 1: Copy SDK source for source-level profiling visibility
  console.log("📋 Setting up SDK source for profiling...");
  const sdkSourceTarget = setupSdkSource();
  console.log(`   SDK source mapped at: ${sdkSourceTarget}`);
  console.log("");

  // Step 2: Register module alias so that imports of
  // `@aws/durable-execution-sdk-js` resolve to the TS source copy.
  // tsx handles TS compilation transparently, so the profiler sees
  // original file paths in the CPU profile.
  //
  // We use Node's module resolution: since we're running with tsx,
  // importing from the source TS directly works. We just need the
  // examples to import from the dur-sdk path instead of the package.
  //
  // The approach: we'll use --import with a loader that rewrites the
  // resolution. But since we're already inside the process, we'll
  // use a simpler technique — Module._resolveFilename override (for CJS)
  // or import.meta.resolve hook. Since tsx already handles TS, we just
  // need to ensure the SDK is imported from source.
  //
  // Simplest approach that works with tsx: register a require hook.
  const Module = await import("node:module");
  const originalResolveFilename = (Module as any).default._resolveFilename;
  const sdkPackagePath = path.resolve(
    __dirname,
    "../../aws-durable-execution-sdk-js",
  );
  const sdkSourceIndex = path.resolve(sdkSourceTarget, "index.ts");

  (Module as any).default._resolveFilename = function (
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ) {
    // Redirect @aws/durable-execution-sdk-js to our source copy
    if (request === "@aws/durable-execution-sdk-js") {
      return sdkSourceIndex;
    }
    // Also handle relative imports from within the SDK source that
    // might try to resolve to the package's dist
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  console.log("   ✓ Module resolution redirected to SDK source");
  console.log("");

  // Step 3: Set up V8 Inspector Session
  const session = new Session();
  session.connect();

  // Step 4: Import test infrastructure (after module hook is set up)
  const { LocalDurableTestRunner } = await import(
    "@aws/durable-execution-sdk-js-testing"
  );

  // Step 5: Discover examples
  const examples = discoverExamples(opts.examples);
  console.log(`📦 Found ${examples.length} examples to profile\n`);

  if (examples.length === 0) {
    console.error("No examples found. Check --examples filter.");
    cleanupSdkSource();
    process.exit(1);
  }

  // Step 6: Set up test environment
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });

  // Step 7: Take initial heap snapshot
  if (opts.heap) {
    console.log("📸 Taking initial heap snapshot...");
    await session.post("HeapProfiler.enable");
    const heapBefore = await takeHeapSnapshot(session);
    const heapBeforePath = path.join(
      opts.outputDir,
      `sdk-heap-before-${timestamp}.heapsnapshot`,
    );
    writeFileSync(heapBeforePath, heapBefore);
    console.log(`   Saved: ${path.basename(heapBeforePath)}\n`);
  }

  // Step 8: Start CPU profiling
  if (opts.cpu) {
    console.log("🔥 Starting CPU profiler (SDK source-level)...\n");
    await session.post("Profiler.enable");
    // Enable detailed sampling for better granularity
    await session.post("Profiler.setSamplingInterval", { interval: 100 }); // 100μs
    await session.post("Profiler.start");
  }

  // Step 9: Run examples
  const results: TimingResult[] = [];

  for (const example of examples) {
    console.log(`▶ ${example.name}`);

    let handlerModule: any;
    try {
      handlerModule = await import(example.handlerPath);
    } catch (e: any) {
      console.log(`  ⚠️  Skipped (import error: ${e.message})`);
      continue;
    }

    const handler = handlerModule.handler || handlerModule.default;
    if (!handler) {
      console.log(`  ⚠️  Skipped (no handler export)`);
      continue;
    }

    for (let i = 0; i < opts.iterations; i++) {
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });

      if (global.gc) global.gc();

      const memBefore = process.memoryUsage();
      const startTime = performance.now();

      try {
        await runner.run();
      } catch {
        // Some examples intentionally throw
      }

      const endTime = performance.now();
      const memAfter = process.memoryUsage();

      results.push({
        example: example.name,
        iteration: i,
        totalMs: endTime - startTime,
        heapUsedBefore: memBefore.heapUsed,
        heapUsedAfter: memAfter.heapUsed,
        heapDelta: memAfter.heapUsed - memBefore.heapUsed,
        rss: memAfter.rss,
      });

      runner.reset();
    }

    const exampleResults = results.filter((r) => r.example === example.name);
    const avg =
      exampleResults.reduce((a, r) => a + r.totalMs, 0) / exampleResults.length;
    const heapAvg =
      exampleResults.reduce((a, r) => a + r.heapDelta, 0) /
      exampleResults.length;
    console.log(
      `   avg: ${avg.toFixed(2)}ms | heap Δ: ${formatBytes(heapAvg)}`,
    );
  }

  // Step 10: Stop CPU profiling
  if (opts.cpu) {
    console.log("\n🛑 Stopping CPU profiler...");
    const { profile } = (await session.post("Profiler.stop")) as any;
    const cpuProfilePath = path.join(
      opts.outputDir,
      `sdk-cpu-${timestamp}.cpuprofile`,
    );
    writeFileSync(cpuProfilePath, JSON.stringify(profile));
    console.log(`   Saved: ${path.basename(cpuProfilePath)}`);
    console.log(`   → Open in Chrome: DevTools → Performance → Load profile`);
    console.log(`   → You'll see individual SDK files like:`);
    console.log(`     • src/dur-sdk/handlers/step-handler/step-handler.ts`);
    console.log(`     • src/dur-sdk/utils/checkpoint/checkpoint-manager.ts`);
    console.log(`     • src/dur-sdk/utils/serdes/serdes.ts`);
    console.log(`     • src/dur-sdk/with-durable-execution.ts`);
    await session.post("Profiler.disable");
  }

  // Step 11: Take final heap snapshot
  if (opts.heap) {
    console.log("\n📸 Taking final heap snapshot...");
    const heapAfter = await takeHeapSnapshot(session);
    const heapAfterPath = path.join(
      opts.outputDir,
      `sdk-heap-after-${timestamp}.heapsnapshot`,
    );
    writeFileSync(heapAfterPath, heapAfter);
    console.log(`   Saved: ${path.basename(heapAfterPath)}`);
    console.log(
      `   → Compare in Chrome DevTools Memory tab: "Comparison" view`,
    );
    await session.post("HeapProfiler.disable");
  }

  // Step 12: Generate timing report
  const summary = summarize(results);
  const report = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    options: opts,
    sdkSourcePath: sdkSourceTarget,
    results,
    summary,
  };

  const reportPath = path.join(
    opts.outputDir,
    `sdk-timing-report-${timestamp}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Step 13: Print summary
  printSummaryTable(summary);

  // Step 14: Cleanup
  await LocalDurableTestRunner.teardownTestEnvironment();
  session.disconnect();
  cleanupSdkSource();

  console.log(`\n📄 Full report: ${path.basename(reportPath)}`);
  console.log("");
  console.log("💡 What to look for in Chrome DevTools:");
  console.log(
    "   • Bottom-Up tab → sort by Self Time → find expensive SDK functions",
  );
  console.log("   • Call Tree tab → see which SDK paths take longest");
  console.log("   • Flame chart → visual hotspots in SDK source files");
  console.log(
    "   • Filter by 'dur-sdk' to isolate SDK code from test infrastructure",
  );
  console.log("");
  console.log("🎯 Common SDK bottlenecks to look for:");
  console.log(
    "   • serdes.ts (serialize/deserialize) — JSON overhead per checkpoint",
  );
  console.log("   • step-id-utils (hashId) — crypto.createHash per operation");
  console.log("   • checkpoint-manager — batching and queue processing");
  console.log("   • concurrent-execution-handler — parallel/map orchestration");
}

function printSummaryTable(summary: ExampleSummary[]) {
  console.log("\n");
  console.log("═".repeat(85));
  console.log(
    " PERFORMANCE SUMMARY — Core SDK (sorted by avg time, slowest first)",
  );
  console.log("═".repeat(85));
  console.log(
    `${"Example".padEnd(45)} ${"Avg".padStart(9)} ${"P50".padStart(9)} ${"P95".padStart(9)} ${"Heap Δ".padStart(10)}`,
  );
  console.log("─".repeat(85));

  for (const s of summary) {
    console.log(
      `${s.example.padEnd(45)} ${(s.avgMs.toFixed(1) + "ms").padStart(9)} ${(s.p50Ms.toFixed(1) + "ms").padStart(9)} ${(s.p95Ms.toFixed(1) + "ms").padStart(9)} ${formatBytes(s.avgHeapDeltaBytes).padStart(10)}`,
    );
  }

  console.log("─".repeat(85));
  const totalAvg = summary.reduce((a, s) => a + s.avgMs, 0);
  console.log(
    `${"TOTAL".padEnd(45)} ${(totalAvg.toFixed(1) + "ms").padStart(9)}`,
  );
}

// ─── Entry Point ────────────────────────────────────────────────────────────

runProfiling().catch((err) => {
  console.error("Profiling failed:", err);
  cleanupSdkSource();
  process.exit(1);
});
