import { buildPreview, PreviewMode, FieldMatchMode } from "./preview";

describe("buildPreview - issue #621: PATH exclude should drop entire subtree", () => {
  it("excludes entire subtree when using FieldMatchMode.PATH on an object field", () => {
    const value = {
      orderId: "o-1",
      customer: { address: { city: "Seattle", zip: "98109" } },
    };

    const preview = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      exclude: [{ name: "customer.address", match: FieldMatchMode.PATH }],
    });

    // The subtree under customer.address must not appear
    expect(preview).toEqual({ orderId: "o-1" });
  });

  it("excludes deeply nested subtree with FieldMatchMode.PATH", () => {
    const value = {
      id: "1",
      a: { b: { c: { secret: "hidden" }, d: "visible" } },
    };

    const preview = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      exclude: [{ name: "a.b.c", match: FieldMatchMode.PATH }],
    });

    expect(preview).toEqual({ id: "1", a: { b: { d: "visible" } } });
  });

  it("excludes entire object field (not just its key) with PATH mode", () => {
    const value = {
      public: "ok",
      pii: { ssn: "123-45-6789", dob: "1990-01-01" },
    };

    const preview = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      exclude: [{ name: "pii", match: FieldMatchMode.PATH }],
    });

    expect(preview).toEqual({ public: "ok" });
  });
});
