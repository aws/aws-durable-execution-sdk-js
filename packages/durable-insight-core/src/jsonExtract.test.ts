/**
 * Guards the linear-time replacements for three polynomial-ReDoS regexes.
 *
 * WHAT WAS WRONG:
 * `verdict.ts` and `llm.ts` (twice) pulled JSON out of free-text model output with
 * `/\{[\s\S]*<marker>[\s\S]*\}/`. Two unbounded `[\s\S]*` around a literal is
 * polynomial: on input that starts a plausible object and never finishes one, the
 * engine retries the inner scan from every start position. CodeQL flagged the
 * `verdict.ts` instance as `js/polynomial-redos` (high). The input is a model reply,
 * whose length is not ours to bound.
 *
 * TWO KINDS OF ASSERTION HERE, and both are needed:
 *
 *   1. EQUIVALENCE. The replacement must accept and reject exactly what the regex
 *      did, or this is a behavior change wearing a performance fix. The old pattern
 *      is reconstructed here and differentially tested against the new function,
 *      including a fuzz over a brace-heavy alphabet. Note what the regex actually
 *      meant: because both quantifiers are greedy and matching is leftmost-longest,
 *      it always resolved to "first `{` to last `}`, marker somewhere between". It
 *      never balanced braces, and neither does the replacement.
 *
 *   2. TIMING. A bound on pathological input, so reintroducing the regex fails
 *      rather than merely being slower. The bound is deliberately loose (1s against
 *      a measured ~2ms) so it cannot flake on a slow CI runner while still catching
 *      a quadratic blowup, which at this input size takes tens of seconds.
 */
import { extractJsonObject, stripTrailingParenthetical } from "./jsonExtract";

/** The regex that used to do this, rebuilt for differential testing. */
function legacyExtract(text: string, marker: string): string | undefined {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    text.match(new RegExp("\\{[\\s\\S]*" + escaped + "[\\s\\S]*\\}"))?.[0] ??
    undefined
  );
}

const MARKER = '"satisfied"';

describe("extractJsonObject matches the regex it replaced", () => {
  it.each([
    ["empty string", ""],
    ["no braces at all", "no json here"],
    ["empty object without the marker", "{}"],
    ["bare object", '{"satisfied":true}'],
    ["object wrapped in prose", 'prose {"satisfied":true} more prose'],
    ["markdown fenced", '```json\n{"satisfied":false,"reason":"x"}\n```'],
    [
      "two objects — spans both, as the regex did",
      '{"satisfied":1} {"satisfied":2}',
    ],
    ["nested braces", '{ outer {"satisfied":true} }'],
    ["marker absent", '{"other":1}'],
    ["closing before opening", "}{"],
    ["only an opening brace", "{"],
    ["only a closing brace", "}"],
    ["unterminated object", '{"satisfied":true'],
    ["marker outside any object", '{}"satisfied"{}'],
    ["marker only after the last brace", '{"a":1}"satisfied"'],
    ["marker immediately after the brace", '{"satisfied"}'],
  ])("agrees on %s", (_label, input) => {
    expect(extractJsonObject(input, MARKER)).toBe(legacyExtract(input, MARKER));
  });

  it("agrees across a fuzz over a brace-heavy alphabet", () => {
    // Random short strings from an alphabet dense in the characters that drive this
    // pattern. Hand-written cases prove the ones we thought of; this covers the
    // combinations we did not.
    const alphabet = ["{", "}", '"q"', "a", " ", "\n", ":", ",", '"'];
    const marker = '"q"';
    const mismatches: string[] = [];
    for (let i = 0; i < 20000; i++) {
      let s = "";
      const len = 1 + (i % 12);
      for (let j = 0; j < len; j++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (extractJsonObject(s, marker) !== legacyExtract(s, marker)) {
        mismatches.push(s);
        if (mismatches.length > 3) break;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("treats the marker as a literal, never as a pattern", () => {
    // `indexOf`, not a regex: a marker containing regex metacharacters must match
    // itself. Passing one to `new RegExp` unescaped would either throw or match
    // something else entirely.
    expect(extractJsonObject('{"a.c":1}', '"a.c"')).toBe('{"a.c":1}');
    expect(extractJsonObject('{"abc":1}', '"a.c"')).toBeUndefined();
  });
});

describe("extractJsonObject is linear on pathological input", () => {
  it("returns promptly on a long run of opening braces", () => {
    // The exact shape CodeQL named: starts with `{{`, repeats, never completes an
    // object. The old regex took ~1.5s at 32k characters and ~24s at 128k.
    const pathological = "{".repeat(200_000) + "x";
    const started = process.hrtime.bigint();
    const result = extractJsonObject(pathological, MARKER);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(result).toBeUndefined();
    // Loose on purpose: measured ~2ms, so 1s cannot flake but still fails a
    // quadratic implementation by orders of magnitude.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("returns promptly when the marker is absent from a long object", () => {
    const pathological = "{" + "a".repeat(200_000);
    const started = process.hrtime.bigint();
    expect(extractJsonObject(pathological, MARKER)).toBeUndefined();
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(1000);
  });
});

describe("stripTrailingParenthetical", () => {
  it.each([
    ["Phi-3.5-mini (smaller, good quality-per-GB, ~2.4 GB)", "Phi-3.5-mini"],
    [
      "Llama-3-Groq-8B Tool-Use (best tool-calling, ~4.9 GB)",
      "Llama-3-Groq-8B Tool-Use",
    ],
    ["NoParens", "NoParens"],
    // Leftmost match: both parentheticals go.
    ["Trailing (a) (b)", "Trailing"],
    ["(only)", ""],
    ["", ""],
    ["Unclosed (a", "Unclosed (a"],
  ])("strips %s", (input, expected) => {
    expect(stripTrailingParenthetical(input)).toBe(expected);
    // Equivalence with the regex it replaced.
    expect(stripTrailingParenthetical(input)).toBe(
      input.replace(/\s*\(.*\)$/, ""),
    );
  });

  it("is linear on a whitespace run that does not end the trimmed prefix", () => {
    // The naive fix here is `.replace(/\s+$/, "")`, the SAME trailing-anchor shape
    // removed from this package in #809.
    //
    // The input shape matters, and a first attempt at this test got it wrong:
    // `"name" + " ".repeat(n) + "(x)"` does NOT catch that regex, because after
    // slicing at `(` the prefix ENDS in whitespace, so `\s+$` succeeds on its first
    // viable start position — linear. The quadratic case is a run that is followed by
    // a non-space, so the anchor is never reachable and the engine retries from every
    // position. Hence the trailing "x" before the parenthesis.
    const pathological = " ".repeat(200_000) + "x(y)";
    const started = process.hrtime.bigint();
    expect(stripTrailingParenthetical(pathological)).toBe(
      " ".repeat(200_000) + "x",
    );
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(1000);
  });
});
