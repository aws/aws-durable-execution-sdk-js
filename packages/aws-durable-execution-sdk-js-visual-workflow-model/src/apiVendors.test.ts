import {
  API_VENDORS,
  API_DIRECTORY,
  API_DIRECTORY_GENERATED_AT,
  findApiVendor,
  findApiDirectoryEntry,
} from "./apiVendors";

describe("API vendor catalog", () => {
  it("has unique ids", () => {
    const ids = API_VENDORS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only links to https spec and docs URLs", () => {
    for (const v of API_VENDORS) {
      expect(v.specUrl).toMatch(/^https:\/\//);
      expect(v.docsUrl).toMatch(/^https:\/\//);
    }
  });

  // The whole point of this catalog is to avoid stale aggregator mirrors, so
  // guard against someone quietly reintroducing one.
  it("never points at a crowdsourced aggregator", () => {
    for (const v of API_VENDORS) {
      expect(v.specUrl).not.toMatch(/apis\.guru|public-apis/i);
    }
  });

  it("declares an env var NAME for every authenticated vendor", () => {
    for (const v of API_VENDORS) {
      if (v.auth.kind === "none") continue;
      // A NAME, never a value — this is what keeps secrets out of a .dar.ts.
      expect(v.auth.envVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("names the header/query parameter when auth needs one", () => {
    for (const v of API_VENDORS) {
      if (v.auth.kind === "header" || v.auth.kind === "query") {
        expect(v.auth.name ?? "").not.toBe("");
      }
    }
  });

  it("looks vendors up by id", () => {
    expect(findApiVendor("stripe")?.label).toBe("Stripe");
    expect(findApiVendor("nope")).toBeUndefined();
  });
});

describe("API directory", () => {
  it("is non-trivially populated", () => {
    expect(API_DIRECTORY.length).toBeGreaterThan(500);
    expect(API_DIRECTORY_GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has unique ids and spec URLs", () => {
    const ids = API_DIRECTORY.map((e) => e.id);
    const urls = API_DIRECTORY.map((e) => e.specUrl);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("only ever points at https vendor URLs, never the aggregator", () => {
    for (const e of API_DIRECTORY) {
      expect(e.specUrl).toMatch(/^https:\/\//);
      // The index came from APIs-guru; the SPECS must not.
      expect(e.specUrl).not.toMatch(/apis\.guru/i);
    }
  });

  it("excludes AWS, which the AWS SDK browser already covers", () => {
    expect(
      API_DIRECTORY.filter((e) => /amazonaws\.com/.test(e.provider)),
    ).toHaveLength(0);
  });

  it("looks directory entries up by id", () => {
    const first = API_DIRECTORY[0];
    expect(findApiDirectoryEntry(first.id)?.specUrl).toBe(first.specUrl);
    expect(findApiDirectoryEntry("definitely-not-here")).toBeUndefined();
  });
});
