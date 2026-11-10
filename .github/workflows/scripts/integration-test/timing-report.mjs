// @ts-check
// Reports how long the integration tests took, per test file and in total,
// and flags files that got much slower than on recent runs.
//
// It reads Vitest's JSON reporter output from this run, and the same output saved as
// an artifact by recent successful Build runs, and writes a table to the job
// summary. A file is slow when it meets either rule (see findOutliers), and
// each slow file gets a warning annotation.
// It never fails the job: timings vary from run to run.
//
// When PR_NUMBER is set, it also keeps one PR comment per Node.js version
// that lists the slow files. It posts the comment only when a file is slow.
// If a later run finds no slow file, it updates the old comment to say so.
//
// Usage: node timing-report.mjs <vitest-json-file> <artifact-name>
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_STEP_SUMMARY,
//      PR_NUMBER (optional)

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
// Added to the ratio rule, so tiny tests (e.g. 0.02s to 0.04s) are not flagged.
const OUTLIER_RATIO_EXTRA_SECONDS = 1;
const OUTLIER_MIN_EXTRA_SECONDS = 5;
const OUTLIER_RULE = `≥${OUTLIER_RATIO}x the median + ${OUTLIER_RATIO_EXTRA_SECONDS}s, or ≥${OUTLIER_MIN_EXTRA_SECONDS}s over the median`;
const TIMINGS_FILE_IN_ARTIFACT = "integration-timings.json";

const [jsonPath, artifactName] = process.argv.slice(2);
const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_RUN_ID,
  GITHUB_STEP_SUMMARY,
  PR_NUMBER,
} = process.env;

/**
 * Per-file wall time in seconds, keyed by path relative to the examples
 * package, from Vitest's JSON reporter output.
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
    // Vitest's JSON reporter has startTime/endTime per file (Jest used perfStats).
    const fileStart = file.perfStats?.start ?? file.startTime;
    const fileEnd = file.perfStats?.end ?? file.endTime;
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
 * Files that meet either rule, compared with their baseline median:
 * - at least OUTLIER_RATIO x the median, plus OUTLIER_RATIO_EXTRA_SECONDS
 * - at least OUTLIER_MIN_EXTRA_SECONDS over the median
 * The first rule catches short tests. The second catches long tests.
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
        seconds >= base * OUTLIER_RATIO + OUTLIER_RATIO_EXTRA_SECONDS ||
        seconds - base >= OUTLIER_MIN_EXTRA_SECONDS,
    )
    .sort((a, b) => b.seconds - b.median - (a.seconds - a.median));
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function github(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
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

/**
 * Body of the PR comment. The first line is a hidden marker, so a later run
 * can find this comment and update it.
 * @param {string} artifactName
 * @param {{ name: string, seconds: number, median: number }[]} outliers
 */
export function commentBody(artifactName, outliers) {
  const nodeVersion = artifactName.replace(/^integration-test-timings-/, "");
  const lines = [
    `<!-- ${artifactName} -->`,
    `### Slow integration tests (Node.js ${nodeVersion})`,
    "",
  ];
  if (outliers.length === 0) {
    lines.push("No test file is slower than usual in the latest run.");
  } else {
    lines.push(
      `Slow means ${OUTLIER_RULE}. The median is from recent runs.`,
      "",
      "| Test file | This run | Median | Change |",
      "|---|---|---|---|",
      ...outliers.map(
        ({ name, seconds, median: base }) =>
          `| ${name} | ${fmt(seconds)} | ${fmt(base)} | +${fmt(seconds - base)} |`,
      ),
    );
  }
  lines.push(
    "",
    `[Run details](https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})`,
  );
  return lines.join("\n");
}

// The GITHUB_TOKEN posts as this user. Only its comments are updated, so a
// person's comment that starts with a copied marker is never edited.
const COMMENT_AUTHOR = "github-actions[bot]";

/**
 * Creates or updates this Node.js version's PR comment. Posts nothing when no
 * file is slow and no comment exists yet.
 * @param {string} artifactName
 * @param {{ name: string, seconds: number, median: number }[]} outliers
 */
export async function updatePrComment(artifactName, outliers) {
  const marker = `<!-- ${artifactName} -->`;
  /** @type {{ id: number } | undefined} */
  let existing;
  for (let page = 1; !existing; page++) {
    const comments = await (
      await github(
        `/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100&page=${page}`,
      )
    ).json();
    existing = comments.find(
      (/** @type {{ body?: string, user?: { login?: string } }} */ c) =>
        c.user?.login === COMMENT_AUTHOR && c.body?.startsWith(marker),
    );
    if (comments.length < 100) break;
  }
  if (!existing && outliers.length === 0) return;
  const body = commentBody(artifactName, outliers);
  if (existing) {
    await github(`/repos/${GITHUB_REPOSITORY}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: { body },
    });
  } else {
    await github(`/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`, {
      method: "POST",
      body: { body },
    });
  }
}

async function main() {
  if (!jsonPath || !existsSync(jsonPath)) {
    console.log(`No Vitest results at ${jsonPath}; nothing to report.`);
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
      `### Slower than usual (${OUTLIER_RULE})`,
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

  // Without a baseline there is nothing to compare, so leave the PR alone.
  if (PR_NUMBER && baseline.runs > 0) {
    try {
      await updatePrComment(artifactName, outliers);
    } catch (error) {
      console.log(`Could not update the PR comment: ${error}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Timings are advisory; never fail the job because of the report.
    console.log(`Timing report failed: ${error}`);
  });
}
