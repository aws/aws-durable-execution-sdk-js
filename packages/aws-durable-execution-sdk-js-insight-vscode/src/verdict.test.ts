import { parseVerdict } from "./verdict";

describe("parseVerdict", () => {
  it("parses a satisfied verdict", () => {
    const v = parseVerdict(
      '{"satisfied": true, "reason": "Counts by status look right."}',
    );
    expect(v.satisfied).toBe(true);
    expect(v.reason).toBe("Counts by status look right.");
    expect(v.suggestion).toBeUndefined();
  });

  it("parses an unsatisfied verdict with a suggestion", () => {
    const v = parseVerdict(
      '{"satisfied": false, "reason": "Returned 0 rows; likely wrong field casing.", "suggestion": "Use json_extract_scalar(input, \'$.claimtype\')."}',
    );
    expect(v.satisfied).toBe(false);
    expect(v.reason).toContain("wrong field casing");
    expect(v.suggestion).toContain("json_extract_scalar");
  });

  it("extracts the JSON even when wrapped in prose/markdown", () => {
    const v = parseVerdict(
      'Here is my assessment:\n```json\n{"satisfied": true, "reason": "Looks good"}\n```\nHope that helps!',
    );
    expect(v.satisfied).toBe(true);
    expect(v.reason).toBe("Looks good");
  });

  it("treats a non-boolean/absent satisfied as not-satisfied (only true means true)", () => {
    const v = parseVerdict('{"satisfied": "yes", "reason": "ambiguous"}');
    expect(v.satisfied).toBe(false);
  });

  it("fails safe to satisfied when no JSON is present (never wedges the loop or hides results)", () => {
    const v = parseVerdict("I could not determine an answer.");
    expect(v.satisfied).toBe(true);
    expect(v.reason).toMatch(/could not parse/i);
  });

  it("fails safe to satisfied on malformed JSON", () => {
    const v = parseVerdict('{"satisfied": true, "reason": "oops"'); // missing closing brace
    expect(v.satisfied).toBe(true);
    expect(v.reason).toMatch(/could not parse/i);
  });
});
