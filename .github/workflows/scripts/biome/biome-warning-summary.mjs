#!/usr/bin/env node
// @ts-check
//
// Renders Biome's warning/info backlog as a compact per-rule markdown table for
// the GitHub Actions job summary.
//
// Why this exists: `biome ci` auto-detects GitHub Actions and turns every
// diagnostic into an inline PR annotation. This repo carries ~1040 warnings and
// infos, nearly all pre-existing, so the unfiltered behaviour buries a PR in
// review noise about lines it never touched. CI therefore gates with
// `--diagnostic-level=error` (formatting violations and lint errors are
// error-severity, so both stay enforced) and routes the rest here, where the
// counts stay visible without annotating anything.
//
// Biome's own `--reporter=summary` lists every offending file, which for this
// repo is hundreds of lines. Counts per rule are the actionable shape: they show
// which rules dominate and which are worth a dedicated follow-up.
//
// CLI usage:
//   npx biome lint --reporter=json | node biome-warning-summary.mjs
//
// Note on --max-diagnostics: it is deliberately NOT passed. Verified empirically
// against Biome 2.5.11 that the json reporter ignores it -- the diagnostics array
// held all 1043 entries at --max-diagnostics=1, 10, 50 and 5000 alike, and
// summary.diagnosticsNotPrinted stayed 0 throughout. Passing a number would imply
// a cap that does not exist. The truncation guard below is kept anyway: the json
// reporter is documented as experimental, so that behaviour could change, and a
// silently undercounting table would read as an improvement.
//
// Always exits 0: this is reporting, never a gate. It must also never report a
// clean tree it could not verify -- a false "no warnings" is worse than an error.

/** @param {string} s */
function stripAnsi(s) {
  // Built via RegExp rather than a literal so the ESC byte does not appear as a
  // control character in source (which noControlCharactersInRegex would flag).
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return String(s).replace(ansi, "");
}

async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Biome's json reporter writes the whole document on a single line, preceded by
 * an "experimental reporter" notice and sometimes followed by a plain-text
 * epilogue ("Some errors were emitted while running checks."). Slicing from the
 * first `{` to end-of-input therefore stops parsing as soon as anything emits
 * that epilogue -- which is exactly when the report matters most. Take the first
 * line that is itself a complete JSON object instead.
 *
 * @param {string} raw
 * @returns {{
 *   ok: boolean,
 *   errors: number,
 *   warnings: number,
 *   infos: number,
 *   notPrinted: number,
 *   diagnostics: { severity: string, category: string }[],
 * }}
 */
function parseReport(raw) {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const doc = JSON.parse(trimmed);
      const summary = doc.summary || {};
      return {
        ok: true,
        // Prefer the summary's counts: they stay authoritative even when the
        // diagnostics array has been capped by --max-diagnostics.
        errors: Number(summary.errors || 0),
        warnings: Number(summary.warnings || 0),
        infos: Number(summary.infos || 0),
        notPrinted: Number(summary.diagnosticsNotPrinted || 0),
        diagnostics: (doc.diagnostics || []).map((d) => ({
          severity: String(d.severity || "unknown"),
          category: String(d.category || "unknown"),
        })),
      };
    } catch {
      // Not the JSON line after all; keep looking.
    }
  }
  return {
    ok: false,
    errors: 0,
    warnings: 0,
    infos: 0,
    notPrinted: 0,
    diagnostics: [],
  };
}

async function main() {
  const report = parseReport(stripAnsi(await readStdin()));

  if (!report.ok) {
    console.log(
      [
        "## Biome",
        "",
        "> [!WARNING]",
        "> Could not parse Biome's JSON output, so the warning backlog is unknown.",
        "> This is a reporting failure, not a clean result.",
      ].join("\n"),
    );
    return;
  }

  const reported = report.warnings + report.infos;
  if (reported === 0) {
    console.log("## Biome\n\nNo warnings or infos. ✅");
    return;
  }

  /** @type {Map<string, { warning: number, info: number, total: number }>} */
  const byRule = new Map();
  for (const { severity, category } of report.diagnostics) {
    // Errors are gated and annotated by the main job; this table is the backlog.
    if (severity === "error") continue;
    const row = byRule.get(category) ?? { warning: 0, info: 0, total: 0 };
    if (severity === "warning") row.warning++;
    else row.info++;
    row.total++;
    byRule.set(category, row);
  }

  const rows = [...byRule.entries()].sort((a, b) => b[1].total - a[1].total);
  const tabulated = rows.reduce((n, [, r]) => n + r.total, 0);

  // Truncated if Biome said so, or if the table accounts for fewer diagnostics
  // than the summary counted. Without this the table would silently undercount
  // once the cap is hit, which would read as an improvement.
  const truncated = report.notPrinted > 0 || tabulated < reported;

  const out = ["## Biome warning backlog", ""];

  if (truncated) {
    out.push(
      "> [!WARNING]",
      `> This table accounts for ${tabulated} of ${reported} diagnostics. Biome capped`,
      "> its output, so per-rule counts are a LOWER BOUND and some rules may be",
      "> missing entirely. Raise `--max-diagnostics` in the `lint:report` script",
      "> for exact numbers.",
      "",
    );
  }

  out.push(
    `**${report.warnings} warnings**, **${report.infos} infos**. None of these fail`,
    "CI -- only errors and formatting violations do. Listed so the backlog stays",
    "visible without annotating lines this PR did not touch.",
    "",
    "| Count | Severity | Rule |",
    "| ----: | -------- | ---- |",
    ...rows.map(
      ([rule, r]) =>
        `| ${r.total} | ${r.warning > 0 && r.info > 0 ? "mixed" : r.warning > 0 ? "warn" : "info"} | \`${rule}\` |`,
    ),
  );
  console.log(out.join("\n"));
}

main().catch((err) => {
  // Reporting must never fail the build, but must not look clean either.
  console.log(
    `## Biome\n\n> [!WARNING]\n> Could not render the warning summary: ${String(err)}`,
  );
});
