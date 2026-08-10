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
const ALLOWED_ENTRIES: ReadonlyArray<{
  file: string;
  source: string;
  reason: string;
}> = [
  {
    file: "hostModuleScan.ts",
    source: String.raw`\bfrom\s*["'](\.[^"']*)["']`,
    reason:
      "hostModuleScan: `\\s*` matches only whitespace and `[^\"']*` stops at a quote, " +
      "so the two cannot compete for the same characters. Measured flat from 2k to 8k.",
  },
  {
    file: "hostModuleScan.ts",
    source: String.raw`(?:^|;)\s*import\s*["'](\.[^"']*)["']`,
    reason:
      "hostModuleScan: as above — disjoint character classes separated by literals.",
  },
  {
    file: "hostModuleScan.ts",
    source: String.raw`\brequire\s*\(\s*["'](\.[^"']*)["']\s*\)`,
    reason: "hostModuleScan: as above.",
  },
  {
    file: "hostModuleScan.ts",
    source: String.raw`\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)`,
    reason: "hostModuleScan: as above.",
  },
  {
    file: "agentLoop.ts",
    source: String.raw`\blimit\s+\d+`,
    reason:
      "agentLoop: `\\s+` and `\\d+` are disjoint, so neither can absorb the other's " +
      "characters. Measured flat.",
  },
  {
    file: "queryShape.ts",
    source: String.raw`\|\s*fields\s+([^|]+)`,
    reason:
      "queryShape: `[^|]+` runs to the next pipe or end of input, and the `fields` " +
      "literal pins the start. Measured flat.",
  },
  {
    file: "queryShape.ts",
    source: String.raw`^\s*\*\s*$`,
    reason:
      "queryShape: anchored at both ends with a literal `*` between the quantifiers, " +
      "so there is one candidate split. Measured flat.",
  },
  {
    file: "queryShape.ts",
    source: String.raw`\*\s*,|\bselect\s+\*`,
    reason:
      "queryShape: an alternation of two short anchored branches, not nested " +
      "quantifiers. Measured flat.",
  },
  {
    file: "queryShape.ts",
    source: String.raw`^([\s\S]*?)(\s+from\s)`,
    reason:
      "queryShape: start-anchored, and the first quantifier is LAZY, so it extends one " +
      "character at a time toward a single required literal rather than backtracking " +
      "over the whole input. Measured flat.",
  },
  {
    file: "jsonExtract.test.ts",
    source: String.raw`\s*\(.*\)$`,
    reason:
      "jsonExtract.test.ts: this IS the vulnerable pattern, kept deliberately to assert " +
      "that `stripTrailingParenthetical` is equivalent to what it replaced. Applied only " +
      "to the short literals in that file, never to input. Removing it would remove the " +
      "equivalence proof, which is worth more than the shape is worth avoiding in a " +
      "fixture.",
  },
  {
    file: "redosGuard.test.ts",
    source: String.raw`(\[\^?(?:\\.|[^\]\\])*\]|\.|\\[sSwWdD])(?:[*+]|\{\d+,\})`,
    reason:
      "This file's WIDE_QUANTIFIER. R3 fires on the outer capture group, but that group is " +
      "not repeated -- a quantifier alternation follows it -- and the alternatives inside " +
      "begin with distinct characters. Measured flat to 4k characters on the witness " +
      "CodeQL named for alert 248.",
  },
  {
    file: "redosGuard.test.ts",
    source: String.raw`(\\.|\[\^?(?:\\.|[^\]\\])*\]|\.|\([^)]*\)|[^\\[\](){}*+?|^$])(?:[*+]|\{\d+,\})`,
    reason:
      "This file's ANY_QUANTIFIER. As above; measured flat to 4k characters across four " +
      "witness shapes.",
  },
  {
    file: "redosGuard.test.ts",
    source: String.raw`\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\[])+)\/[gimsuy]*`,
    reason:
      "This file's regex-literal extractor. It WAS exponential -- 2x per `[]`, 40ms at 22 " +
      "repetitions, CodeQL alerts 249/251 -- because a `[` could be consumed either by " +
      "the character-class alternative or as a plain character. Excluding `[` from the " +
      "fallback leaves one parse; measured flat to 2k repetitions and verified to extract " +
      "identically across all 11,417 lines of this package.",
  },
];

/**
 * `file\u0000source` for every exemption.
 *
 * KEYED BY FILE AS WELL AS PATTERN, and that is the whole point. Keying on the pattern
 * alone meant the exemption written for the deliberately-vulnerable fixture in
 * `jsonExtract.test.ts` ALSO exempted the identical regex anywhere else -- including
 * production code. Demonstrated: adding `/\s*\(.*\)$/` to `verdict.ts` left the guard
 * green. A justification is about a pattern IN A PLACE, so the key has to carry both.
 */
const ALLOWED = new Set(
  ALLOWED_ENTRIES.map((e) => `${e.file}\u0000${e.source}`),
);

/**
 * Every `.ts` file in this package, TESTS INCLUDED, recursively.
 *
 * Tests were excluded at first, to stop the sweep flagging the pattern text in this
 * file's own documentation. That exclusion also blinded it to the one place a regex is
 * most likely to be exotic: the scanner below. CodeQL then flagged three regexes in this
 * very file (alerts 248-251, `js/redos`, EXPONENTIAL) which the guard could not
 * structurally have found -- a ReDoS in the ReDoS detector, invisible to itself.
 *
 * So tests are scanned, and the narrower fix is used instead: skip COMMENT LINES rather
 * than whole files. Prose about a pattern is not a pattern. The `String.raw` entries in
 * ALLOWED and in the self-tests are string literals rather than regex literals, so the
 * extractor never saw them anyway.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
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
 * Split a pattern into the fragments that an anchor could independently govern:
 * on `|` at any depth, and at group boundaries.
 *
 * Deliberately over-splits. A fragment that is not really a separate branch can only
 * cause an extra finding, which the allowlist absorbs after a measurement; a branch that
 * is missed hides a quadratic path, which is the defect this rule exists to catch.
 * Character classes are stepped over so a `|` or `(` inside one is not a boundary.
 */
function alternationBranches(source: string): string[] {
  const out: string[] = [];
  let current = "";
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    // An escape is a backslash that is not itself escaped.
    const escaped =
      i > 0 && source[i - 1] === "\\" && !(i > 1 && source[i - 2] === "\\");
    if (escaped) {
      current += char;
      continue;
    }
    if (inClass) {
      current += char;
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      current += char;
      continue;
    }
    if (char === "|" || char === "(" || char === ")") {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  // The whole pattern counts as a branch too, for the single-alternative case.
  return [source, ...out].filter((s) => s.length > 0);
}

/** True when a fragment ends in `$`, is not start-anchored, and has a quantifier. */
function hasTrailingAnchorRisk(fragment: string): boolean {
  if (!fragment.endsWith("$") || fragment.startsWith("^")) return false;
  return [...fragment.matchAll(ANY_QUANTIFIER)].length >= 1;
}

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

  // R2 -- a quantifier plus an END anchor and no START anchor. When the anchor is
  // unreachable the engine retries from every position, which is exactly the shape
  // CodeQL flagged in #809 (`/\/+$/`, `/\s+$/`). A start anchor removes it: there is
  // then only one place to begin.
  //
  // APPLIED PER BRANCH, not to the whole pattern. Testing `source.endsWith("$")` and
  // `source.startsWith("^")` assumes those anchors govern every alternative, and they
  // do not: `/a+$|x/` does not end with `$`, `/^x|a+$/` does start with `^`, and BOTH
  // have a quadratic `a+$` branch -- measured 6ms at 2k characters rising 4x per
  // doubling to 394ms at 16k. Both scored zero before this.
  if (alternationBranches(source).some(hasTrailingAnchorRisk)) {
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
          // `[^/\n\\[]` — the trailing `[` exclusion is load-bearing, not tidiness.
          // Without it a `[` could be consumed EITHER by the character-class
          // alternative or as a plain character, so `/[][][]...` had two parses per
          // repetition and this regex was EXPONENTIAL: 2x per `[]`, 40ms at 22
          // repetitions, ~40s at 32. CodeQL alerts 249/251 (js/redos, high). Excluding
          // `[` from the fallback leaves exactly one parse, and a bare `[` outside a
          // class is not valid in a regex literal anyway. Verified to extract
          // identically across all 11,417 lines of this package.
          /\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\[])+)\/[gimsuy]*/g,
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
    // ALTERNATION. Neither of these is caught by testing the whole pattern's first and
    // last characters -- the first does not end with `$`, the second does start with
    // `^` -- yet both have a quadratic `a+$` branch, measured 6ms at 2k characters
    // rising 4x per doubling to 394ms at 16k. Both scored zero until R2 became
    // per-branch.
    [String.raw`a+$|x`, "R2"],
    [String.raw`^x|a+$`, "R2"],
    // The same escape inside a group rather than a bare alternation.
    [String.raw`^(?:x|a+$)`, "R2"],
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
    // Every branch start-anchored: no branch can retry from many positions.
    String.raw`^a+$|^b+$`,
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
    expect(risky.length).toBeGreaterThanOrEqual(ALLOWED_ENTRIES.length);
    const sources = risky.map((r) => r.source);
    expect(sources).toContain(String.raw`^([\s\S]*?)(\s+from\s)`);
    expect(sources).toContain(String.raw`\blimit\s+\d+`);
  });

  it("does not exempt a pattern outside the file it was justified in", () => {
    // THE LEAK THIS CLOSES:
    // `ALLOWED` was keyed by regex source alone, so the exemption written for the
    // deliberately-vulnerable fixture in `jsonExtract.test.ts` also exempted the
    // identical regex in production. Demonstrated by adding `/\s*\(.*\)$/` to
    // `verdict.ts`, which left the guard green.
    //
    // Fixing that structurally is not enough on its own -- reverting the key to
    // source-only passes every other test in this file, which is how the leak existed
    // in the first place. This asserts the keying directly.
    const fixture = ALLOWED_ENTRIES.find(
      (e) => e.file === "jsonExtract.test.ts",
    );
    expect(fixture).toBeDefined();
    const source = fixture?.source ?? "";
    expect(ALLOWED.has(`jsonExtract.test.ts\u0000${source}`)).toBe(true);
    // The same pattern in production code is NOT covered by that justification.
    expect(ALLOWED.has(`verdict.ts\u0000${source}`)).toBe(false);
    expect(ALLOWED.has(`llm.ts\u0000${source}`)).toBe(false);
  });

  it("has no allowlist entry that is no longer present", () => {
    // A stale entry silently widens the rule. If a pattern is gone, its exemption
    // should go with it.
    const present = new Set(risky.map((r) => `${r.file}\u0000${r.source}`));
    const orphans = ALLOWED_ENTRIES.filter(
      (e) => !present.has(`${e.file}\u0000${e.source}`),
    ).map((e) => `${e.file}  /${e.source}/`);
    expect(orphans).toEqual([]);
  });

  it("every risky pattern is allowlisted with a reason", () => {
    const unjustified = risky
      .filter((r) => !ALLOWED.has(`${r.file}\u0000${r.source}`))
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
    // NON-TEST files, and CODE lines only, for two different reasons.
    //
    // Comments: `jsonExtract.ts` DOCUMENTS the pattern it replaced, and a whole-file
    // scan flags that documentation — the fourth time a scanner in this repo has
    // reported its own prose.
    //
    // Tests: this file's own self-tests carry the pattern as DATA, on ordinary code
    // lines, so scanning tests here would flag the very assertions that prove the
    // detector works. Unlike the class sweep above, which handles tests through
    // ALLOWED, this check is a hardcoded assertion about production code — so it is
    // scoped to production code.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC).filter(
      (f) => !f.endsWith(".test.ts"),
    )) {
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
