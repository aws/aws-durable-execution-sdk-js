import { escapeQuotedString, escapeRegex } from "./logsInsights";

describe("escapeQuotedString", () => {
  it("leaves an ordinary execution ARN unchanged", () => {
    const arn =
      "arn:aws:lambda:us-east-1:123456789012:function:my-fn:$LATEST/exec-abc123";
    expect(escapeQuotedString(arn)).toBe(arn);
  });

  it("escapes a double quote", () => {
    expect(escapeQuotedString('a"b')).toBe('a\\"b');
  });

  it("escapes a backslash", () => {
    expect(escapeQuotedString("a\\b")).toBe("a\\\\b");
  });

  it("escapes a trailing backslash so it cannot escape the closing quote (the CodeQL bug)", () => {
    // Naive quote-only escaping left this as "trailing\\" — a lone trailing
    // backslash that, embedded in `filter x = "trailing\"`, would escape the
    // closing quote and break out of the string literal.
    expect(escapeQuotedString("trailing\\")).toBe("trailing\\\\");
  });

  it("escapes backslashes before quotes (order matters, no double-escaping)", () => {
    // Input: backslash then quote. Backslash-first yields \\ then \" — i.e.
    // a literal backslash followed by an escaped quote, not a mangled \\\".
    expect(escapeQuotedString('\\"')).toBe('\\\\\\"');
  });

  it("produces a fully-balanced literal for a value packed with metacharacters", () => {
    const embedded = `"${escapeQuotedString('x"\\y')}"`;
    // The escaped value, wrapped in quotes, is a single well-formed literal:
    // opening quote, x, escaped quote, escaped backslash, y, closing quote.
    expect(embedded).toBe('"x\\"\\\\y"');
  });
});

describe("escapeRegex", () => {
  it("escapes regex metacharacters including backslash", () => {
    expect(escapeRegex("a.b*c\\d")).toBe("a\\.b\\*c\\\\d");
  });

  it("leaves a plain ARN substring unescaped except for its metacharacters", () => {
    // ':' and '/' are not regex metacharacters, so they pass through.
    expect(escapeRegex("arn:aws:lambda:exec/abc")).toBe(
      "arn:aws:lambda:exec/abc",
    );
  });
});
