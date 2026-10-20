import {
  extractFirstJsonObject,
  parseLocalServerQueryResponse,
} from "./localServerParse";

describe("extractFirstJsonObject", () => {
  it("returns a bare JSON object unchanged", () => {
    expect(extractFirstJsonObject('{"query":"SELECT 1"}')).toBe(
      '{"query":"SELECT 1"}',
    );
  });

  it("extracts JSON wrapped in prose (before and after)", () => {
    const text =
      'Sure! Here is your query:\n{"query":"SELECT 1"}\nHope that helps.';
    expect(extractFirstJsonObject(text)).toBe('{"query":"SELECT 1"}');
  });

  it("handles nested objects and stops at the matching brace", () => {
    const text = 'noise {"a":{"b":1},"query":"x"} trailing } brace';
    expect(extractFirstJsonObject(text)).toBe('{"a":{"b":1},"query":"x"}');
  });

  it("ignores braces inside string literals", () => {
    const text = '{"query":"SELECT \'{\' AS c"}';
    expect(extractFirstJsonObject(text)).toBe(text);
  });

  it("respects escaped quotes inside strings", () => {
    const text = '{"query":"a \\" } still-in-string"}';
    expect(extractFirstJsonObject(text)).toBe(text);
  });

  it("returns null when there is no object", () => {
    expect(extractFirstJsonObject("no json here")).toBeNull();
  });

  it("returns null when braces never balance", () => {
    expect(extractFirstJsonObject('{"query":"unterminated')).toBeNull();
  });
});

describe("parseLocalServerQueryResponse", () => {
  it("parses a valid response and trims fields", () => {
    const out = parseLocalServerQueryResponse(
      '{"query":"  SELECT 1  ","explanation":"  hi  ","timeRangeMs":3600000,"suggestedCharts":["bar"]}',
    );
    expect(out).toEqual({
      query: "SELECT 1",
      explanation: "hi",
      timeRangeMs: 3600000,
      suggestedCharts: ["bar"],
    });
  });

  it("parses valid JSON embedded in prose", () => {
    const out = parseLocalServerQueryResponse(
      'Here you go:\n{"query":"SELECT 2"}\nDone.',
    );
    expect(out.query).toBe("SELECT 2");
    expect(out.explanation).toBe("");
    expect(out.timeRangeMs).toBeUndefined();
  });

  it("throws when the response has no JSON object", () => {
    expect(() => parseLocalServerQueryResponse("I cannot help")).toThrow(
      /did not return a valid query/,
    );
  });

  it("throws on malformed JSON", () => {
    expect(() => parseLocalServerQueryResponse('{"query": SELECT 1}')).toThrow(
      /did not return valid JSON/,
    );
  });

  it("throws when query is missing", () => {
    expect(() =>
      parseLocalServerQueryResponse('{"explanation":"no query here"}'),
    ).toThrow(/empty query/);
  });

  it("throws when query is blank", () => {
    expect(() => parseLocalServerQueryResponse('{"query":"   "}')).toThrow(
      /empty query/,
    );
  });
});
