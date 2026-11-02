// @ts-check
// Reports how long the integration tests took, per test file and in total,
// and flags files that got much slower than on recent runs.
//
// It reads Jest's --json output from this run, and the same output saved as
// an artifact by recent successful Build runs, and writes a table to the job
// summary. Files that are slower than their recent median by both
// OUTLIER_RATIO and OUTLIER_MIN_EXTRA_SECONDS get a warning annotation.
// It never fails the job: timings vary from run to run.
//
// Usage: node timing-report.mjs <jest-json-file> <artifact-name>
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_STEP_SUMMARY

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const BASELINE_RUNS = 10;
const OUTLIER_RATIO = 1.5;
const OUTLIER_MIN_EXTRA_SECONDS = 5;
const TIMINGS_FILE_IN_ARTIFACT = "integration-timings.json";

const [jsonPath, artifactName] = process.argv.slice(2);
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_STEP_SUMMARY } =
  process.env;

/**
 * Per-file wall time in seconds, keyed by path relative to the examples
 * package, from Jest's --json output.
 * @param {any} results
 * @returns {{ total: number, files: Record<string, number>, slowestTests: [string, number][] }}
 */
export function summarize(results) {
  /** @type {Record<string, number>} */
  const files = {};
  /** @type {[string, number][]} */
  const tests = [];
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const file of results.testResults ?? []) {
    const { start: fileStart, end: fileEnd } = file.perfStats ?? {};
    if (typeof fileStart !== "number" || typeof fileEnd !== "number") continue;
    const name = relative(process.cwd(), file.name).replace(
      /^.*?src\/examples\//,
      "",
    );
    files[name] = (fileEnd - fileStart) / 1000;
    start = Math.min(start, fileStart);
    end = Math.max(end, fileEnd);
    for (const test of file.assertionResults ?? []) {
      if (typeof test.duration === "number") {
        tests.push([`${name} > ${test.title}`, test.duration / 1000]);
      }
    }
  }
  tests.sort((a, b) => b[1] - a[1]);
  return {
    total: end > start ? (end - start) / 1000 : 0,
    files,
    slowestTests: tests.slice(0, 10),
  };
}

/** @param {number[]} values */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Files slower than their baseline median by both the ratio and the margin.
 * @param {Record<string, number>} files
 * @param {Record<string, number[]>} baseline
 */
export function findOutliers(files, baseline) {
  return Object.entries(files)
    .filter(([name]) => (baseline[name]?.length ?? 0) > 0)
    .map(([name, seconds]) => ({
      name,
      seconds,
      median: median(baseline[name]),
    }))
    .filter(
      ({ seconds, median: base }) =>
        seconds >= base * OUTLIER_RATIO &&
        seconds - base >= OUTLIER_MIN_EXTRA_SECONDS,
    )
    .sort((a, b) => b.seconds - b.median - (a.seconds - a.median));
}

/** @param {string} path */
async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response;
}

/**
 * Timings saved by recent successful Build runs, per file.
 * @returns {Promise<{ runs: number, files: Record<string, number[]> }>}
 */
async function loadBaseline() {
  /** @type {Record<string, number[]>} */
  const files = {};
  let runs = 0;
  const { workflow_runs: workflowRuns } = await (
    await github(
      `/repos/${GITHUB_REPOSITORY}/actions/workflows/build.yml/runs?status=success&per_page=30`,
    )
  ).json();
  const dir = mkdtempSync(join(tmpdir(), "timings-"));
  for (const run of workflowRuns) {
    if (runs >= BASELINE_RUNS) break;
    if (String(run.id) === GITHUB_RUN_ID) continue;
    const { artifacts } = await (
      await github(
        `/repos/${GITHUB_REPOSITORY}/actions/runs/${run.id}/artifacts?name=${encodeURIComponent(artifactName)}`,
      )
    ).json();
    const artifact = artifacts.find((a) => !a.expired);
    if (!artifact) continue;
    const zip = join(dir, `${run.id}.zip`);
    writeFileSync(
      zip,
      Buffer.from(
        await (
          await github(new URL(artifact.archive_download_url).pathname)
        ).arrayBuffer(),
      ),
    );
    const saved = JSON.parse(
      execFileSync("unzip", ["-p", zip, TIMINGS_FILE_IN_ARTIFACT], {
        encoding: "utf8",
      }),
    );
    for (const [name, seconds] of Object.entries(saved.files ?? {})) {
      if (!files[name]) files[name] = [];
      files[name].push(/** @type {number} */ (seconds));
    }
    runs++;
  }
  return { runs, files };
}

/** @param {number} seconds */
const fmt = (seconds) => `${seconds.toFixed(1)}s`;

async function main() {
  if (!jsonPath || !existsSync(jsonPath)) {
    console.log(`No Jest results at ${jsonPath}; nothing to report.`);
    return;
  }
  const current = summarize(JSON.parse(readFileSync(jsonPath, "utf8")));
  // The artifact step uploads this file, so later runs can compare with it.
  writeFileSync(TIMINGS_FILE_IN_ARTIFACT, JSON.stringify(current));

  /** @type {{ runs: number, files: Record<string, number[]> }} */
  let baseline = { runs: 0, files: {} };
  try {
    baseline = await loadBaseline();
  } catch (error) {
    console.log(`Could not load the baseline: ${error}`);
  }
  const outliers = findOutliers(current.files, baseline.files);

  const lines = [
    `## Integration test timings (${artifactName.replace(/^integration-test-timings-/, "Node.js ")})`,
    "",
    `Total: **${fmt(current.total)}** across ${Object.keys(current.files).length} test files. ` +
      (baseline.runs > 0
        ? `Compared with the median of the last ${baseline.runs} successful runs.`
        : "No earlier runs to compare with yet."),
    "",
  ];
  if (outliers.length > 0) {
    lines.push(
      `### Slower than usual (≥${OUTLIER_RATIO}x and ≥${OUTLIER_MIN_EXTRA_SECONDS}s over the median)`,
      "",
      "| Test file | This run | Median | Change |",
      "|---|---|---|---|",
      ...outliers.map(
        ({ name, seconds, median: base }) =>
          `| ${name} | ${fmt(seconds)} | ${fmt(base)} | +${fmt(seconds - base)} |`,
      ),
      "",
    );
    for (const { name, seconds, median: base } of outliers) {
      console.log(
        `::warning title=Slow integration test::${name} took ${fmt(seconds)}, usual ${fmt(base)}`,
      );
    }
  } else if (baseline.runs > 0) {
    lines.push("No test file is slower than usual.", "");
  }
  lines.push(
    "<details><summary>All test files, slowest first</summary>",
    "",
    "| Test file | This run | Median |",
    "|---|---|---|",
    ...Object.entries(current.files)
      .sort((a, b) => b[1] - a[1])
      .map(([name, seconds]) => {
        const base = baseline.files[name];
        return `| ${name} | ${fmt(seconds)} | ${base?.length ? fmt(median(base)) : "-"} |`;
      }),
    "",
    "</details>",
    "",
    "<details><summary>Slowest tests</summary>",
    "",
    "| Test | Time |",
    "|---|---|",
    ...current.slowestTests.map(
      ([name, seconds]) => `| ${name} | ${fmt(seconds)} |`,
    ),
    "",
    "</details>",
    "",
  );
  const markdown = lines.join("\n");
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, markdown);
  else console.log(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Timings are advisory; never fail the job because of the report.
    console.log(`Timing report failed: ${error}`);
  });
}
