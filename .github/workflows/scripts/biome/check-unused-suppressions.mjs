#!/usr/bin/env node
// @ts-check
//
// Fails if Biome reports any unused suppression.
//
// Why this needs its own gate: `suppressions/unused` ("Suppression comment has no
// effect") is warning-severity and is not a configurable lint rule, so the main
// `biome ci --diagnostic-level=error` gate filters it out entirely. Two suppressions
// in this repo's Biome migration were dead for that reason -- one with its reason
// wrapped onto a second line, one where the code was refactored so the rule could no
// longer see the violation at all -- and neither CI nor a local `biome lint` run
// surfaced it. (`biome lint` alone caps output at 20 diagnostics, and
// `--max-diagnostics=0` prints none, so both are easy to mistake for clean.)
//
// An unused suppression matters more than it looks. It means either the rationale is
// suppressing nothing, or the finding it documented has left the backlog silently --
// which reads as harmless cruft rather than a lost finding.
//
// CLI usage:
//   npx biome lint --reporter=json | node check-unused-suppressions.mjs
//
// Exits 1 if any unused suppression is found, 0 otherwise.

async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** @param {string} s */
function stripAnsi(s) {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return String(s).replace(ansi, "");
}

async function main() {
  const raw = stripAnsi(await readStdin());

  // The json reporter writes the document on a single line, with a notice before it
  // and sometimes a plain-text epilogue after; take the first line that is itself a
  // complete JSON object.
  let doc = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      doc = JSON.parse(trimmed);
      break;
    } catch {
      // keep looking
    }
  }

  if (doc === null) {
    console.error(
      "::error::Could not parse Biome JSON output; unused-suppression check did not run.",
    );
    process.exit(1);
  }

  // Truncation guard, matching the one in biome-warning-summary.mjs. Biome 2.5.11's
  // json reporter emits every diagnostic regardless of --max-diagnostics (verified:
  // 1032 emitted, diagnosticsNotPrinted 0), so this cannot fire today. It exists
  // because the reporter is documented as experimental: if a future version starts
  // honouring a cap, this gate would pass while never seeing the suppressions it is
  // meant to catch. A gate that silently stops checking is the precise failure mode
  // this script was added to close, so it fails loudly rather than trusting a
  // partial report.
  const notPrinted = Number(doc.summary?.diagnosticsNotPrinted || 0);
  if (notPrinted > 0) {
    console.error(
      `::error::Biome capped its diagnostics (${notPrinted} not printed); the unused-suppression check cannot be trusted. Raise the cap or pass --max-diagnostics explicitly.`,
    );
    process.exit(1);
  }

  const unused = (doc.diagnostics || []).filter(
    (d) => String(d.category) === "suppressions/unused",
  );

  if (unused.length === 0) {
    console.log("No unused suppressions.");
    return;
  }

  console.error(`Found ${unused.length} unused suppression(s):`);
  for (const d of unused) {
    const path = d.location?.path ?? "<unknown>";
    console.error(`  ${path}`);
    console.error(
      "::error file=" +
        path +
        "::Suppression comment has no effect. Either the reason wrapped onto a second line (Biome requires it on one line), or the code no longer triggers the rule -- in which case the finding was silenced rather than suppressed. Remove the comment or restore the suppressed construct.",
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(`::error::unused-suppression check failed: ${String(err)}`);
  process.exit(1);
});
