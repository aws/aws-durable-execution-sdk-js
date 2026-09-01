#!/usr/bin/env node
// @ts-check
//
// Renders Biome's warning/info backlog as a compact per-rule markdown table for
// the GitHub Actions job summary.
//
// Why this exists: `biome ci` auto-detects GitHub Actions and turns every
// diagnostic into an inline PR annotation. This repo carries ~1200 warnings and
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
//   node biome-warning-summary.mjs            # reads `biome lint` JSON from stdin
//   npx biome lint --reporter=json ... | node biome-warning-summary.mjs
//
// Always exits 0: this is reporting, never a gate.

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
 * @param {string} raw
 * @returns {{ severity: string, category: string }[]}
 */
function parseDiagnostics(raw) {
  // Biome prints a notice about the experimental json reporter before the JSON
  // body, so find the first `{` rather than parsing the whole stream.
  const start = raw.indexOf("{");
  if (start === -1) return [];
  try {
    const doc = JSON.parse(raw.slice(start));
    return (doc.diagnostics || []).map((d) => ({
      severity: String(d.severity || "unknown"),
      category: String(d.category || "unknown"),
    }));
  } catch {
    return [];
  }
}

async function main() {
  const diagnostics = parseDiagnostics(stripAnsi(await readStdin()));

  if (diagnostics.length === 0) {
    console.log("## Biome\n\nNo warnings or infos. ✅");
    return;
  }

  /** @type {Map<string, { warning: number, info: number, total: number }>} */
  const byRule = new Map();
  for (const { severity, category } of diagnostics) {
    const row = byRule.get(category) ?? { warning: 0, info: 0, total: 0 };
    if (severity === "warning") row.warning++;
    else row.info++;
    row.total++;
    byRule.set(category, row);
  }

  const rows = [...byRule.entries()].sort((a, b) => b[1].total - a[1].total);
  const warnings = rows.reduce((n, [, r]) => n + r.warning, 0);
  const infos = rows.reduce((n, [, r]) => n + r.info, 0);

  const out = [
    "## Biome warning backlog",
    "",
    `**${warnings} warnings**, **${infos} infos**. None of these fail CI — only`,
    "errors and formatting violations do. Listed so the backlog stays visible",
    "without annotating lines this PR did not touch.",
    "",
    "| Count | Severity | Rule |",
    "| ----: | -------- | ---- |",
    ...rows.map(
      ([rule, r]) =>
        `| ${r.total} | ${r.warning > 0 && r.info > 0 ? "mixed" : r.warning > 0 ? "warn" : "info"} | \`${rule}\` |`,
    ),
  ];
  console.log(out.join("\n"));
}

main().catch((err) => {
  // Reporting must never fail the build.
  console.log(`## Biome\n\nCould not render warning summary: ${String(err)}`);
});
