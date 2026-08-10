/**
 * Class-level guard against super-linear-backtracking regexes in this package.
 *
 * WHY THIS EXISTS:
 * This is the third round of the same finding. #809 fixed three trailing-anchor
 * regexes (`/\/+$/`, `/\s+$/`) after CodeQL flagged one of them. CodeQL then flagged
 * a fourth in `verdict.ts` — a different shape, two unbounded `[\s\S]*` around a
 * literal — and sweeping for THAT shape turned up three more the scanner had not
 * reported.
 *
 * Each round fixed instances. The recurring mistake was scoping the sweep to the
 * shape that had just been found, so the next shape was invisible: exactly the
 * mistake made with `HOST_MODULES` (guarding `vscode` and missing `electron`) and with
 * the query choke point (guarding `run*Query` and missing `fetchAthenaRecord`).
 *
 * This guard was itself written that way first, which is the best evidence that the
 * mistake is easy to make. Its original rule was "two or more wide quantifiers", so it
 * scored BOTH regexes #809 removed below threshold — `/\/+$/` at literally zero,
 * because an escaped literal is not a wide character class — and `(a+)+$`, the textbook
 * exponential case, at zero as well. The paragraphs above were already here while the
 * code enforced something narrower than they described.
 *
 * HOW IT WORKS:
 * Every regex literal in this package's non-test sources is extracted and scored by
 * `riskRules` against THREE independent shapes. Matching any one of them means the
 * pattern must appear in ALLOWED below with a note on why it is safe:
 *
 *   R1  Two or more WIDE quantifiers (`.*`, `[^x]+`, `\s*`, ...). Two atoms that can
 *       each consume many different characters may compete for the same input, which
 *       is the JSON-extraction shape that prompted this file.
 *
 *   R2  Any quantifier — wide or a single escaped literal — together with a trailing
 *       `$` and no leading `^`. When the anchor is unreachable the engine retries from
 *       every start position. This is precisely the #809 shape, and it needs no wide
 *       class at all: `/\/+$/` is quadratic on a run of slashes. A leading `^` removes
 *       the risk, because there is then only one place to begin.
 *
 *   R3  A repeated GROUP — `(...)*`, `(...)+`, `(...){2,}`. `(a+)+` is EXPONENTIAL
 *       rather than merely polynomial, and even `(ab)+` can backtrack across
 *       alternatives. None exist here today; the rule is cheap and the failure mode is
 *       the worst of the three.
 *
 * The three rules are necessary conditions, not proofs of a defect — see below.
 *
 * WHY AN ALLOWLIST RATHER THAN A BAN:
 * Nine patterns in this package match a rule and are genuinely linear, because their
 * quantifiers cannot overlap: disjoint character classes, a literal pinned between
 * them, a lazy quantifier, or an anchor at both ends. Every entry was MEASURED, not
 * reasoned about — growth from 2k to 8k characters of adversarial input, where
 * quadratic shows as ~16x and linear as ~1x. Banning these shapes outright would force
 * pointless rewrites of correct code, and a guard that cries wolf gets deleted.
 *
 * ADDING AN ENTRY IS THE POINT AT WHICH TO MEASURE. If you cannot state the input that
 * would be pathological and show that it is not, the pattern does not belong here.
 *
 * THE DETECTOR HAS ITS OWN TESTS, and they matter more than the sweep. Asserting that
 * today's sources are clean says nothing about whether the detector can find anything —
 * those assertions pass just as well against a detector narrowed to uselessness, which
 * is how the R1-only version shipped. `riskRules` is therefore tested directly against
 * every shape this repository has actually had to remove, plus canonical exponential
 * cases, plus benign patterns it must NOT flag.
 *
 * Test files are excluded from the sweep on purpose: this file's own ALLOWED map and
 * self-tests contain pattern text, and three earlier scanners in this repo flagged
 * their own documentation.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = __dirname;

/**
 * Patterns that match one of the three rules in `riskRules` and are nonetheless
 * linear, each with the reason. Keyed by the regex SOURCE rather than by file and line,
 * so ordinary edits do not invalidate the list.
 */
const ALLOWED = new Map<string, string>([
  [
    String.raw`\bfrom\s*["'](\.[^"']*)["']`,
    "hostModuleScan: `\\s*` matches only whitespace and `[^\"']*` stops at a quote, " +
      "so the two cannot compete for the same characters. Measured flat from 2k to 8k.",
  ],
  [
    String.raw`(?:^|;)\s*import\s*["'](\.[^"']*)["']`,
    "hostModuleScan: as above — disjoint character classes separated by literals.",
  ],
  [
    String.raw`\brequire\s*\(\s*["'](\.[^"']*)["']\s*\)`,
    "hostModuleScan: as above.",
  ],
  [
    String.raw`\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)`,
    "hostModuleScan: as above.",
  ],
  [
    String.raw`\blimit\s+\d+`,
    "agentLoop: `\\s+` and `\\d+` are disjoint, so neither can absorb the other's " +
      "characters. Measured flat.",
  ],
  [
    String.raw`\|\s*fields\s+([^|]+)`,
    "queryShape: `[^|]+` runs to the next pipe or end of input, and the `fields` " +
      "literal pins the start. Measured flat.",
  ],
  [
    String.raw`^\s*\*\s*$`,
    "queryShape: anchored at both ends with a literal `*` between the quantifiers, " +
      "so there is one candidate split. Measured flat.",
  ],
  [
    String.raw`\*\s*,|\bselect\s+\*`,
    "queryShape: an alternation of two short anchored branches, not nested " +
      "quantifiers. Measured flat.",
  ],
  [
    String.raw`^([\s\S]*?)(\s+from\s)`,
    "queryShape: start-anchored, and the first quantifier is LAZY, so it extends one " +
      "character at a time toward a single required literal rather than backtracking " +
      "over the whole input. Measured flat.",
  ],
]);

/** Every non-test `.ts` file in this package, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

interface Found {
  file: string;
  line: number;
  source: string;
  risks: string[];
}

/**
 * A quantified atom whose character class is WIDE -- it can consume many different
 * characters, so two of them in one pattern can compete for the same input.
 */
const WIDE_QUANTIFIER =
  /(\[\^?(?:\\.|[^\]\\])*\]|\.|\\[sSwWdD])(?:[*+]|\{\d+,\})/g;

/**
 * ANY quantified atom, wide or not -- including a single escaped literal such as
 * `\/+`. Needed because the trailing-anchor shape does not require a wide class:
 * `/\/+$/` is quadratic on a run of slashes.
 */
const ANY_QUANTIFIER =
  /(\\.|\[\^?(?:\\.|[^\]\\])*\]|\.|\([^)]*\)|[^\\[\](){}*+?|^$])(?:[*+]|\{\d+,\})/g;

/** A repeated GROUP: `(...)*`, `(...)+`, `(...){2,}`. */
const REPEATED_GROUP = /\)(?:[*+]|\{\d+,\})/;

/**
 * Score one pattern against the three shapes that produce super-linear backtracking.
 *
 * The first version of this guard implemented only R1, which is how it managed to pass
 * clean on BOTH regexes #809 removed and on `(a+)+$`, the textbook exponential case --
 * while its own header argued against scoping a sweep to the shape just found. R2 and
 * R3 close that, and cost nothing: they add no new findings in this package today.
 */
function riskRules(source: string): string[] {
  const found: string[] = [];

  // R1 -- two or more wide quantifiers can compete for the same characters, which is
  // the JSON-extraction shape (`[\s\S]*` ... `[\s\S]*`).
  const wide = [...source.matchAll(WIDE_QUANTIFIER)].length;
  if (wide >= 2) found.push(`R1: ${wide} wide quantifiers`);

  // R2 -- one quantifier plus an END anchor and no START anchor. When the anchor is
  // unreachable the engine retries from every position, which is exactly the shape
  // CodeQL flagged in #809 (`/\/+$/`, `/\s+$/`). A start anchor removes it: there is
  // then only one place to begin.
  const anyQuantifier = [...source.matchAll(ANY_QUANTIFIER)].length;
  if (anyQuantifier >= 1 && source.endsWith("$") && !source.startsWith("^")) {
    found.push("R2: quantifier with a trailing $ and no leading ^");
  }

  // R3 -- a repeated group. `(a+)+` is exponential rather than merely polynomial, and
  // even `(ab)+` can backtrack across alternatives. Rare here, and cheap to require a
  // justification for.
  if (REPEATED_GROUP.test(source)) found.push("R3: repeated group");

  return found;
}

/**
 * Extract regex literals and score them.
 *
 * Deliberately a lexical scan rather than a parse. It can miss a literal spelled in an
 * unusual way, and it does not see `new RegExp(...)` built from variables -- so it is a
 * floor on coverage, not a proof of absence. CodeQL remains the primary detector; this
 * exists to stop a KNOWN class from being reintroduced between scans, and to force the
 * measurement conversation when someone adds one.
 */
function findRiskyRegexes(): Found[] {
  const found: Found[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, "utf-8")
      .split("\n")
      .forEach((line, index) => {
        // Skip comment lines: prose about a pattern is not a pattern.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const match of line.matchAll(
          /\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+)\/[gimsuy]*/g,
        )) {
          const risks = riskRules(match[1]);
          if (risks.length > 0) {
            found.push({
              file: file.slice(SRC.length + 1),
              line: index + 1,
              source: match[1],
              risks,
            });
          }
        }
      });
  }
  return found;
}

const risky = findRiskyRegexes();

/**
 * Self-tests for the detector, against every shape this repository has actually had to
 * remove.
 *
 * WHY THESE ARE THE MOST IMPORTANT TESTS IN THE FILE:
 * The assertions below prove that the CURRENT sources are clean. They say nothing about
 * whether the detector could find anything, so they pass just as well if it is narrowed
 * to uselessness. The first version of this guard implemented only R1 and therefore
 * scored `/\/+$/` -- the regex CodeQL flagged in #809 -- at ZERO, while its header
 * argued against exactly that mistake. These cases are what stop the spec from drifting
 * away from the prose again.
 *
 * Every entry is a real historical pattern or a canonical textbook case, not an
 * invention.
 */
describe("the detector catches every shape this package has had to remove", () => {
  it.each([
    // #809: CodeQL js/polynomial-redos, trailing slash strip. Measured 174s at 320k.
    [String.raw`\/+$`, "R2"],
    // #809: trailing whitespace strip, two instances in moved files.
    [String.raw`\s+$`, "R2"],
    // This change: CodeQL alert #247, JSON extraction from model output.
    [String.raw`\{[\s\S]*"satisfied"[\s\S]*\}`, "R1"],
    [String.raw`\{[\s\S]*"query"[\s\S]*\}`, "R1"],
    // This change: label parenthetical strip -- caught by both rules.
    [String.raw`\s*\(.*\)$`, "R1"],
    // Canonical exponential backtracking. Not present here, and must never be.
    [String.raw`(a+)+$`, "R3"],
    [String.raw`(a|aa)+$`, "R3"],
    // Repeated group without nesting: still worth a justification.
    [String.raw`(ab)+c`, "R3"],
  ])("flags %s under %s", (pattern, rule) => {
    const risks = riskRules(pattern);
    expect(risks.length).toBeGreaterThan(0);
    expect(risks.join(" ")).toContain(rule);
  });

  it.each([
    // Start-anchored: one place to begin, so no retry-from-every-position.
    String.raw`^\d+$`,
    // A single wide quantifier with no end anchor.
    String.raw`\s*`,
    // No quantifier at all.
    String.raw`\bselect\b`,
  ])("does not flag the benign pattern %s", (pattern) => {
    // Acceptance matters as much as detection: a detector that flagged everything
    // would satisfy the cases above while making the allowlist meaningless.
    expect(riskRules(pattern)).toEqual([]);
  });
});

describe("no unjustified polynomial-ReDoS candidates", () => {
  it("scans the package and finds the patterns it is meant to see", () => {
    // Non-vacuity. A scan that silently matched nothing — a changed literal syntax, a
    // renamed directory — would make the assertion below trivially true, which is the
    // failure mode of every scanner in this repo that has needed fixing.
    expect(risky.length).toBeGreaterThanOrEqual(ALLOWED.size);
    const sources = risky.map((r) => r.source);
    expect(sources).toContain(String.raw`^([\s\S]*?)(\s+from\s)`);
    expect(sources).toContain(String.raw`\blimit\s+\d+`);
  });

  it("has no allowlist entry that is no longer present", () => {
    // A stale entry silently widens the rule. If a pattern is gone, its exemption
    // should go with it.
    const sources = new Set(risky.map((r) => r.source));
    const orphans = [...ALLOWED.keys()].filter((k) => !sources.has(k));
    expect(orphans).toEqual([]);
  });

  it("every risky pattern is allowlisted with a reason", () => {
    const unjustified = risky
      .filter((r) => !ALLOWED.has(r.source))
      .map(
        (r) => `${r.file}:${r.line}  /${r.source}/  [${r.risks.join("; ")}]`,
      );
    // A pattern here matches R1, R2 or R3 and has no measured justification. The
    // failure message names the file, line, pattern and rule. Measure it: build the
    // adversarial input the rule implies, time it at 2k and 8k characters, then either
    // fix it or add it to ALLOWED with the numbers.
    expect(unjustified).toEqual([]);
  });

  it("the JSON extraction that caused this guard is gone", () => {
    // The specific regression, named. `extractJsonObject` replaced three copies of
    // this; if one comes back, fail here rather than waiting for the next CodeQL scan.
    // CODE lines only. `jsonExtract.ts` DOCUMENTS the pattern it replaced, and a
    // whole-file scan flags that documentation — the fourth time a scanner in this
    // repo has reported its own prose. The rule is now settled: a name or a pattern in
    // a comment is not a use, so every scanner here skips comments.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const codeLines = readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
      if (/\[\\s\\S\]\*[^/]*\[\\s\\S\]\*/.test(codeLines.join("\n"))) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
