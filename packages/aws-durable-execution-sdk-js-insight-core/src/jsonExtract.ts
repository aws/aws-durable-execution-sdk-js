/**
 * Linear-time extraction of a JSON object from free-text model output.
 *
 * THE FAILURE THIS REPLACES:
 * Three call sites independently used the same idiom to pull JSON out of a model
 * reply that may be wrapped in prose or markdown fences:
 *
 *     text.match(/\{[\s\S]*"satisfied"[\s\S]*\}/)   // verdict.ts
 *     text.match(/\{[\s\S]*"query"[\s\S]*\}/)       // llm.ts, twice
 *
 * Two unbounded `[\s\S]*` around a literal is polynomial: on input that begins a
 * plausible object and never completes one, the engine retries the inner scan from
 * every starting position. Measured growth is 4x per doubling of input — 6ms at 2k
 * characters, 96ms at 8k, 1.5s at 32k, and roughly 24s at 128k. The input is a model
 * response, so its length is not ours to bound, and a verbose reply reaches those
 * sizes easily. CodeQL flagged the `verdict.ts` instance as `js/polynomial-redos`
 * (high); the other two are the same expression against a different marker.
 *
 * WHAT THE REGEX ACTUALLY MEANT:
 * Because both quantifiers are greedy and a regex match is leftmost-longest, that
 * pattern always resolved to "from the FIRST `{` to the LAST `}`, provided the marker
 * appears somewhere between them". It was never a JSON parser and never balanced
 * braces. This function computes that same span by index, which is linear, and
 * `jsonExtract.test.ts` asserts the two agree across a corpus that includes the
 * pathological inputs.
 */

/**
 * Return the substring from the first `{` to the last `}` when the marker appears
 * strictly between them, mirroring `/\{[\s\S]*<marker>[\s\S]*\}/`.
 *
 * @param text   Free-text model output, possibly with prose or fences around JSON.
 * @param marker A literal that must appear inside the object, e.g. `"satisfied"`.
 *               Compared as a plain substring, never as a pattern.
 * @returns The candidate JSON text, or `undefined` when there is no such span. The
 *          result is NOT validated as JSON — callers still parse it and handle
 *          failure, exactly as they did with the regex.
 */
export function extractJsonObject(
  text: string,
  marker: string,
): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;

  const end = text.lastIndexOf("}");
  // `\}` has to match at or after the position `\{` matched, and the marker needs
  // room between them, so an end at or before the start is no match.
  if (end <= start) return undefined;

  // The marker must lie strictly inside: the leading `\{` consumes index `start`
  // and the trailing `\}` consumes index `end`, so the searchable region is the
  // interior. `indexOf` here is a substring search, not a pattern match, so it
  // cannot backtrack.
  const interior = text.slice(start + 1, end);
  if (!interior.includes(marker)) return undefined;

  return text.slice(start, end + 1);
}

/**
 * Strip a trailing parenthetical from a label: `"Phi-3.5-mini (smaller, ~2.4 GB)"`
 * becomes `"Phi-3.5-mini"`.
 *
 * CONTRACT, where it differs from the regex it replaces: a parenthetical containing a
 * NEWLINE is stripped here, whereas the regex left it in place because `.` does not
 * match a line terminator. This is the only divergence, it is unreachable today -- the
 * only inputs are three single-line preset labels -- and stripping is the behavior the
 * caller wants, so it is the intended contract rather than an accident. Every
 * single-line input agrees exactly, which `jsonExtract.test.ts` asserts against the
 * original pattern.
 *
 * Replaces `label.replace(/\s*\(.*\)$/, "")`, which has the same polynomial shape as
 * the extraction above (unbounded `.*` before an anchored `\)`). That instance was
 * NOT exploitable — its input is one of three hardcoded preset labels, which is why
 * CodeQL did not flag it — but the shape is removed so that making labels dynamic
 * later cannot quietly reintroduce a slow path.
 */
export function stripTrailingParenthetical(label: string): string {
  if (!label.endsWith(")")) return label;
  // FIRST `(`, not the last. A regex match is leftmost, so `\s*\(.*\)$` anchors on
  // the earliest `(` that still has the final `)` after it: "Trailing (a) (b)"
  // becomes "Trailing", not "Trailing (a)". Using `lastIndexOf` here looked obviously
  // right and was caught only by asserting equivalence with the regex it replaces.
  const open = label.indexOf("(");
  if (open === -1) return label;
  // Drop the parenthetical, then the whitespace that preceded it — `\s*` sat outside
  // the group in the original, so it was removed too.
  //
  // `trimEnd()`, deliberately NOT `.replace(/\s+$/, "")`: that is the same
  // trailing-anchor shape removed from this package in #809, and writing it here
  // while removing it two functions above would be absurd. `trimEnd` strips exactly
  // the set JavaScript's `\s` matches (WhiteSpace plus LineTerminator), in linear
  // time.
  return label.slice(0, open).trimEnd();
}
