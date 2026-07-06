import { parseChartSpec, extractJsonObject } from "./chartSpec";

const COLS = ["product_category", "hour_bucket", "record_count"];

describe("extractJsonObject", () => {
  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("extracts a balanced object and ignores trailing prose with a brace", () => {
    const raw = '{"mark":"bar","encoding":{}} hope this helps :}';
    expect(extractJsonObject(raw)).toBe('{"mark":"bar","encoding":{}}');
  });

  it("ignores braces inside string literals", () => {
    const raw = '{"title":"a } b","x":1}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("strips leading prose / code fences before the object", () => {
    const raw =
      'Here is your spec:\n```json\n{"mark":"bar","encoding":{}}\n```';
    expect(extractJsonObject(raw)).toBe('{"mark":"bar","encoding":{}}');
  });
});

describe("parseChartSpec", () => {
  const bar = (field: string) =>
    `{"mark":"bar","encoding":{"x":{"field":"${field}","type":"nominal"},"y":{"field":"record_count","type":"quantitative"}}}`;

  it("parses a valid spec whose fields are all real columns", () => {
    const spec = parseChartSpec(bar("product_category"), COLS);
    expect(spec.mark).toBe("bar");
    expect(spec.encoding).toBeDefined();
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseChartSpec("sorry, I cannot", COLS)).toThrow(
      /did not return/i,
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => parseChartSpec('{"mark":"bar", encoding:}', COLS)).toThrow(
      /invalid/i,
    );
  });

  it("throws when mark or encoding is missing", () => {
    expect(() => parseChartSpec('{"mark":"bar"}', COLS)).toThrow(
      /missing mark\/encoding/i,
    );
    expect(() => parseChartSpec('{"encoding":{}}', COLS)).toThrow(
      /missing mark\/encoding/i,
    );
  });

  it("rejects an unknown / misspelled field and names it", () => {
    expect(() => parseChartSpec(bar("product_cat"), COLS)).toThrow(
      /unknown column\(s\): product_cat/,
    );
  });

  it("allows channels with no field (aggregate count, datum)", () => {
    const raw =
      '{"mark":"bar","encoding":{"x":{"field":"hour_bucket"},"y":{"aggregate":"count","type":"quantitative"}}}';
    expect(() => parseChartSpec(raw, COLS)).not.toThrow();
    const withDatum = '{"mark":"rule","encoding":{"y":{"datum":100}}}';
    expect(() => parseChartSpec(withDatum, COLS)).not.toThrow();
  });

  it("validates fields inside array channels (tooltip)", () => {
    const raw =
      '{"mark":"bar","encoding":{"x":{"field":"hour_bucket"},"tooltip":[{"field":"record_count"},{"field":"nope"}]}}';
    expect(() => parseChartSpec(raw, COLS)).toThrow(
      /unknown column\(s\): nope/,
    );
  });

  it("validates nested field references (sort.field)", () => {
    const raw =
      '{"mark":"bar","encoding":{"x":{"field":"product_category","sort":{"field":"nope","op":"sum"}},"y":{"field":"record_count"}}}';
    expect(() => parseChartSpec(raw, COLS)).toThrow(
      /unknown column\(s\): nope/,
    );
  });

  it("accepts a valid nested sort field", () => {
    const raw =
      '{"mark":"bar","encoding":{"x":{"field":"product_category","sort":{"field":"record_count","op":"sum"}},"y":{"field":"record_count"}}}';
    expect(() => parseChartSpec(raw, COLS)).not.toThrow();
  });

  it("parses a spec even with trailing prose after the object", () => {
    const raw = `${bar("hour_bucket")}\nThat should work!`;
    expect(parseChartSpec(raw, COLS).mark).toBe("bar");
  });
});
