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
// Each Node.js version's job saves its slow files in its timings artifact.
// It also saves the tests that failed in this run. When a run passes only
// after a rerun, its earlier artifacts hold those failed tests. A test that
// failed like this in at least FLAKY_MIN_RUNS of the last BASELINE_RUNS
// successful runs is flaky, and gets a warning annotation.
// After both jobs finish, the --comment mode reads those artifacts and keeps
// one PR comment that lists each slow file once, with a column per version.
// The comment also lists the flaky tests. It is posted only when a file is
// slow or a test is flaky. If a later run finds neither, it updates the old
// comment to say so.
//
// Usage: node timing-report.mjs <vitest-json-file> <artifact-name>
//        node timing-report.mjs --comment <folder-of-downloaded-artifacts>
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_STEP_SUMMARY,
//      PR_NUMBER, TESTS_PASSED and NODE_VERSIONS (--comment only)

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
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
// "Flaky" means more than once in the BASELINE_RUNS runs. One failure can be
// an outage, such as Lambda throttling.
const FLAKY_MIN_RUNS = 2;
const FLAKY_RULE = `failed and then passed on a rerun in at least ${FLAKY_MIN_RUNS} of the last ${BASELINE_RUNS} successful runs`;

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
 * @returns {{ total: number, files: Record<string, number>, slowestTests: [string, number][], failedTests: string[] }}
 */
export function summarize(results) {
  /** @type {Record<string, number>} */
  const files = {};
  /** @type {[string, number][]} */
  const tests = [];
  /** @type {string[]} */
  const failedTests = [];
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
      // After the first failure, bail marks the tests that did not run as
      // skipped and fails their files. So only a test with status "failed"
      // really failed.
      if (test.status === "failed") failedTests.push(`${name} > ${test.title}`);
    }
  }
  tests.sort((a, b) => b[1] - a[1]);
  return {
    total: end > start ? (end - start) / 1000 : 0,
    files,
    slowestTests: tests.slice(0, 10),
    failedTests,
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
 * The artifact created last, or undefined for an empty list.
 * @template {{ created_at: string }} T
 * @param {T[]} artifacts
 * @returns {T | undefined}
 */
export function newest(artifacts) {
  return [...artifacts].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
}

/**
 * Timings and failed tests saved by recent successful Build runs.
 *
 * `files` holds the timings of each file, from the newest artifact of each
 * run. `flaky` counts, per test, the runs in which the test failed in one
 * attempt. Each of these runs ended in success, so the test passed on a rerun.
 * @returns {Promise<{ runs: number, files: Record<string, number[]>, flaky: Record<string, number> }>}
 */
async function loadBaseline() {
  /** @type {Record<string, number[]>} */
  const files = {};
  /** @type {Record<string, number>} */
  const flaky = {};
  let runs = 0;
  const { workflow_runs: workflowRuns } = await (
    await github(
      `/repos/${GITHUB_REPOSITORY}/actions/workflows/build.yml/runs?status=success&per_page=30`,
    )
  ).json();
  const dir = mkdtempSync(join(tmpdir(), "timings-"));
  /** @param {{ id: number, archive_download_url: string }} artifact */
  const read = async (artifact) => {
    const zip = join(dir, `${artifact.id}.zip`);
    writeFileSync(
      zip,
      Buffer.from(
        await (
          await github(new URL(artifact.archive_download_url).pathname)
        ).arrayBuffer(),
      ),
    );
    return JSON.parse(
      execFileSync("unzip", ["-p", zip, TIMINGS_FILE_IN_ARTIFACT], {
        encoding: "utf8",
      }),
    );
  };
  for (const run of workflowRuns) {
    if (runs >= BASELINE_RUNS) break;
    if (String(run.id) === GITHUB_RUN_ID) continue;
    const { artifacts } = await (
      await github(
        `/repos/${GITHUB_REPOSITORY}/actions/runs/${run.id}/artifacts?name=${encodeURIComponent(artifactName)}`,
      )
    ).json();
    const kept = artifacts.filter(
      (/** @type {{ expired: boolean }} */ a) => !a.expired,
    );
    // A rerun keeps the artifact of each earlier attempt. An earlier attempt
    // failed, and bail stopped most of its files at about 0s. So the timings
    // come from the newest artifact, which the passing attempt uploaded.
    const last = newest(kept);
    if (!last) continue;
    const saved = await read(last);
    for (const [name, seconds] of Object.entries(saved.files ?? {})) {
      if (!files[name]) files[name] = [];
      files[name].push(/** @type {number} */ (seconds));
    }
    // The earlier artifacts hold the tests that failed before the rerun.
    const failed = new Set();
    for (const artifact of kept) {
      if (artifact === last) continue;
      for (const name of (await read(artifact)).failedTests ?? []) {
        failed.add(name);
      }
    }
    for (const name of failed) flaky[name] = (flaky[name] ?? 0) + 1;
    runs++;
  }
  return { runs, files, flaky };
}

/**
 * Tests that failed and then passed on a rerun in at least FLAKY_MIN_RUNS
 * runs, most runs first.
 * @param {Record<string, number>} counts Runs per test, from loadBaseline.
 * @returns {Flaky[]}
 */
export function findFlaky(counts) {
  return Object.entries(counts)
    .filter(([, runs]) => runs >= FLAKY_MIN_RUNS)
    .map(([name, runs]) => ({ name, runs }))
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
}

/** @param {number} seconds */
const fmt = (seconds) => `${seconds.toFixed(1)}s`;

/**
 * @typedef {{ name: string, seconds: number, median: number }} Outlier
 * @typedef {{ name: string, runs: number }} Flaky
 * @typedef {{ version: string, baselineRuns: number, outliers: Outlier[], flaky: Flaky[] }} VersionReport
 */

// The first line of the PR comment. It is hidden, and lets a later run find
// the comment and update it.
const COMMENT_MARKER = "<!-- integration-test-timings -->";

/**
 * Body of the PR comment: one row per slow file and one row per flaky test,
 * one column per Node.js version, so a file that is slow on both versions is
 * listed once.
 * @param {VersionReport[]} reports Only versions that have a baseline.
 * @param {boolean} complete Whether every integration test job passed.
 */
export function commentBody(reports, complete) {
  /** @type {Map<string, Map<string, Outlier>>} */
  const slow = new Map();
  for (const { version, outliers } of reports) {
    for (const outlier of outliers) {
      if (!slow.has(outlier.name)) slow.set(outlier.name, new Map());
      slow.get(outlier.name)?.set(version, outlier);
    }
  }
  const lines = [COMMENT_MARKER, "### Slow integration tests", ""];
  if (!complete) {
    lines.push(
      "Some integration tests failed or stopped early. So test files that did not run are not checked.",
      "",
    );
  }
  if (slow.size === 0) {
    lines.push("No test file is slower than usual in the latest run.");
  } else {
    /** @param {Map<string, Outlier>} byVersion */
    const maxExtra = (byVersion) =>
      Math.max(...[...byVersion.values()].map((o) => o.seconds - o.median));
    lines.push(
      `Slow means ${OUTLIER_RULE}. The median is from recent runs.`,
      "",
      `| Test file | ${reports.map((r) => `Node.js ${r.version}`).join(" | ")} |`,
      `|---|${reports.map(() => "---|").join("")}`,
      ...[...slow.entries()]
        .sort((a, b) => maxExtra(b[1]) - maxExtra(a[1]))
        .map(([name, byVersion]) => {
          const cells = reports.map(({ version }) => {
            const outlier = byVersion.get(version);
            return outlier
              ? `${fmt(outlier.seconds)} (median ${fmt(outlier.median)})`
              : "-";
          });
          return `| ${name} | ${cells.join(" | ")} |`;
        }),
    );
  }
  lines.push("", ...flakyLines(reports));
  lines.push(
    "",
    `[Run details](https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})`,
  );
  return lines.join("\n");
}

/**
 * The flaky test part of the PR comment. It comes from earlier runs, not from
 * this run, so it does not depend on whether this run passed.
 * @param {VersionReport[]} reports
 */
function flakyLines(reports) {
  /** @type {Map<string, Map<string, number>>} */
  const flaky = new Map();
  for (const { version, flaky: tests = [] } of reports) {
    for (const { name, runs } of tests) {
      if (!flaky.has(name)) flaky.set(name, new Map());
      flaky.get(name)?.set(version, runs);
    }
  }
  const lines = ["### Flaky integration tests", ""];
  if (flaky.size === 0) {
    lines.push("No test is flaky in recent runs.");
    return lines;
  }
  /** @param {Map<string, number>} byVersion */
  const maxRuns = (byVersion) => Math.max(...byVersion.values());
  lines.push(
    `Flaky means ${FLAKY_RULE}.`,
    "",
    `| Test | ${reports.map((r) => `Node.js ${r.version}`).join(" | ")} |`,
    `|---|${reports.map(() => "---|").join("")}`,
    ...[...flaky.entries()]
      .sort((a, b) => maxRuns(b[1]) - maxRuns(a[1]) || a[0].localeCompare(b[0]))
      .map(([name, byVersion]) => {
        const cells = reports.map(({ version, baselineRuns }) => {
          const runs = byVersion.get(version);
          return runs ? `${runs} of ${baselineRuns} runs` : "-";
        });
        return `| ${name} | ${cells.join(" | ")} |`;
      }),
  );
  return lines;
}

/**
 * Reads the timings that each Node.js version's job saved in this run.
 * @param {string} dir One folder per integration-test-timings-* artifact, as
 *   download-artifact writes them.
 * @returns {VersionReport[]}
 */
export function loadReports(dir) {
  // readdirSync order depends on the file system, so sort for stable columns.
  return readdirSync(dir)
    .sort()
    .map((name) => ({
      version: name.replace(/^integration-test-timings-/, ""),
      saved: JSON.parse(
        readFileSync(join(dir, name, TIMINGS_FILE_IN_ARTIFACT), "utf8"),
      ),
    }))
    .map(({ version, saved }) => ({
      version,
      baselineRuns: saved.baselineRuns,
      outliers: saved.outliers,
      // Artifacts saved before flaky tests were tracked have no flaky list.
      flaky: saved.flaky ?? [],
    }));
}

// The GITHUB_TOKEN posts as this user. Only its comments are updated, so a
// person's comment that starts with a copied marker is never edited.
const COMMENT_AUTHOR = "github-actions[bot]";

/**
 * Creates or updates the PR comment. Posts nothing when no file is slow, no
 * test is flaky and no comment exists yet.
 *
 * It changes an old warning to "no file is slow" only after a full check:
 * every job passed, and every expected version has a report with a baseline.
 * A failed or stopped run may skip the slow file, and a job can pass without
 * uploading its timings. So neither case may clear the warning.
 * @param {VersionReport[]} reports
 * @param {boolean} complete Whether every integration test job passed.
 * @param {string[]} versions The Node.js versions the test jobs run.
 */
export async function updatePrComment(reports, complete, versions) {
  const marker = COMMENT_MARKER;
  const compared = reports.filter((r) => r.baselineRuns > 0);
  const anyFound = reports.some(
    (r) => r.outliers.length > 0 || r.flaky.length > 0,
  );
  const fullCheck =
    complete &&
    versions.length > 0 &&
    versions.every((v) => compared.some((r) => r.version === v));
  if (!anyFound && !fullCheck) return;
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
  if (!existing && !anyFound) return;
  const body = commentBody(compared, complete);
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

  /** @type {{ runs: number, files: Record<string, number[]> }} */
  let baseline = { runs: 0, files: {}, flaky: {} };
  try {
    baseline = await loadBaseline();
  } catch (error) {
    console.log(`Could not load the baseline: ${error}`);
  }
  const outliers = findOutliers(current.files, baseline.files);
  const flaky = findFlaky(baseline.flaky);
  // The artifact step uploads this file. Later runs compare with its files
  // and read its failed tests. The PR comment job in this run reads its
  // outliers and flaky tests.
  writeFileSync(
    TIMINGS_FILE_IN_ARTIFACT,
    JSON.stringify({
      ...current,
      baselineRuns: baseline.runs,
      outliers,
      flaky,
    }),
  );

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
  if (flaky.length > 0) {
    lines.push(
      `### Flaky (${FLAKY_RULE})`,
      "",
      "| Test | Runs |",
      "|---|---|",
      ...flaky.map(
        ({ name, runs }) => `| ${name} | ${runs} of ${baseline.runs} |`,
      ),
      "",
    );
    for (const { name, runs } of flaky) {
      console.log(
        `::warning title=Flaky integration test::${name} failed and then passed on a rerun in ${runs} of the last ${baseline.runs} successful runs`,
      );
    }
  } else if (baseline.runs > 0) {
    lines.push("No test is flaky in recent runs.", "");
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
  const run =
    jsonPath === "--comment"
      ? // Here the second argument is the folder of downloaded artifacts.
        async () =>
          updatePrComment(
            loadReports(artifactName),
            process.env.TESTS_PASSED === "true",
            (process.env.NODE_VERSIONS ?? "").split(",").filter(Boolean),
          )
      : main;
  run().catch((error) => {
    // Timings are advisory; never fail the job because of the report.
    console.log(`Timing report failed: ${error}`);
  });
}
