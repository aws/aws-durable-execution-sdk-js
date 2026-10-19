import { parseVerdict, buildAnalysisPrompt } from "./verdict";

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

describe("buildAnalysisPrompt", () => {
  it("includes the question, columns, and rows", () => {
    const p = buildAnalysisPrompt({
      question: "list the input keys",
      columns: ["k"],
      rows: [["claimtype"], ["customername"]],
    });
    expect(p).toContain("Question: list the input keys");
    expect(p).toContain("Columns: k");
    expect(p).toContain("k=claimtype");
    expect(p).toContain("k=customername");
  });

  it("includes the goal line only when a goal is given", () => {
    const withGoal = buildAnalysisPrompt({
      question: "q",
      goal: "the distinct keys",
      columns: ["k"],
      rows: [["a"]],
    });
    expect(withGoal).toContain("What to extract: the distinct keys");

    const without = buildAnalysisPrompt({
      question: "q",
      columns: ["k"],
      rows: [["a"]],
    });
    expect(without).not.toContain("What to extract");
  });

  it("caps the number of rows and reports the truncation", () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`row${i}`]);
    const p = buildAnalysisPrompt({
      question: "q",
      columns: ["k"],
      rows,
      maxRows: 50,
    });
    expect(p).toContain("Rows (50 of 120, truncated)");
    expect(p).toContain("k=row49");
    expect(p).not.toContain("k=row50");
  });

  it("truncates oversized cell values", () => {
    const big = "x".repeat(1000);
    const p = buildAnalysisPrompt({
      question: "q",
      columns: ["c"],
      rows: [[big]],
      maxCellChars: 100,
    });
    expect(p).toContain("…(truncated)");
    expect(p).not.toContain("x".repeat(200));
  });

  it("handles an empty result set", () => {
    const p = buildAnalysisPrompt({ question: "q", columns: ["k"], rows: [] });
    expect(p).toContain("Rows (0):");
    expect(p).toContain("(no rows)");
  });
});
