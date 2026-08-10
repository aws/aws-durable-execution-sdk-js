/**
 * Class-level guard against polynomial-ReDoS regexes in this package.
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
 * the query choke point (guarding `run*Query` and missing `fetchAthenaRecord`). So
 * this guard is about the CLASS: any regex with two or more unbounded quantifiers must
 * be justified, whatever its shape.
 *
 * HOW IT WORKS:
 * Every regex literal in this package's non-test sources is extracted and scored by
 * how many unbounded quantifiers it contains (`.*`, `.+`, `[^x]*`, `\s+`, ...). Two or
 * more means the engine can be made to retry an inner scan from many start positions,
 * which is the necessary condition for polynomial backtracking. Such a pattern must
 * appear in ALLOWED below, with a note on why it is safe.
 *
 * WHY AN ALLOWLIST RATHER THAN A BAN:
 * Two unbounded quantifiers are necessary but not sufficient — seven patterns here are
 * genuinely linear because their quantifiers cannot overlap (different character
 * classes, or a literal pinned between them). Every entry was MEASURED, not reasoned
 * about: growth from 2k to 8k characters of adversarial input, where quadratic shows
 * as ~16x and linear as ~1x. Banning the shape outright would force pointless rewrites
 * of correct code, and a guard that cries wolf gets deleted.
 *
 * ADDING AN ENTRY IS THE POINT AT WHICH TO MEASURE. If you cannot state the input that
 * would be pathological and show it is not, the pattern does not belong here.
 *
 * Test files are excluded from the scan on purpose: this file's own ALLOWLIST contains
 * pattern text, and two earlier scanners in this repo flagged their own documentation.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = __dirname;

/**
 * Patterns with two or more unbounded quantifiers that are nonetheless linear.
 * Keyed by the regex SOURCE rather than by file and line, so ordinary edits do not
 * invalidate the list.
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
  unbounded: number;
}

/**
 * Extract regex literals and count unbounded quantifiers.
 *
 * Deliberately a lexical scan rather than a parse. It can miss a literal spelled in an
 * unusual way, and it does not see `new RegExp(...)` built from variables — so it is a
 * floor on coverage, not a proof of absence. CodeQL remains the primary detector; this
 * exists to stop a KNOWN class from being reintroduced between scans, and to force the
 * measurement conversation when someone adds one.
 */
function findRiskyRegexes(): Found[] {
  const found: Found[] = [];
  // A quantified atom that can consume arbitrary characters: `.`, a character class,
  // or a whitespace/word/digit class, followed by `*` or `+`.
  const unboundedAtom = /(\[\^?(?:\\.|[^\]])*\]|\.|\\[sSwWdD])[*+]/g;

  for (const file of sourceFiles(SRC)) {
    readFileSync(file, "utf-8")
      .split("\n")
      .forEach((line, index) => {
        // Skip comment lines: prose about a pattern is not a pattern.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const match of line.matchAll(
          /\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\n\\])+)\/[gimsuy]*/g,
        )) {
          const source = match[1];
          const count = [...source.matchAll(unboundedAtom)].length;
          if (count >= 2) {
            found.push({
              file: file.slice(SRC.length + 1),
              line: index + 1,
              source,
              unbounded: count,
            });
          }
        }
      });
  }
  return found;
}

const risky = findRiskyRegexes();

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
      .map((r) => `${r.file}:${r.line}  /${r.source}/`);
    // A pattern here has two or more unbounded quantifiers and no measured
    // justification. Measure it: build the adversarial input, time it at 2k and 8k
    // characters, and either fix it or add it to ALLOWED with the numbers.
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
