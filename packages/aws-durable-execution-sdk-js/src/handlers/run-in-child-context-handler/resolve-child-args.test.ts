import { resolveChildArgs } from "./resolve-child-args";

describe("resolveChildArgs", () => {
  const fn = async (): Promise<string> => "result";
  const options = { subType: "Step" } as never;

  it("parses the (name, fn, options) form", () => {
    const r = resolveChildArgs("my-context", fn, options);
    expect(r.name).toBe("my-context");
    expect(r.fn).toBe(fn);
    expect(r.options).toBe(options);
  });

  it("parses the (name, fn) form", () => {
    const r = resolveChildArgs("my-context", fn);
    expect(r.name).toBe("my-context");
    expect(r.fn).toBe(fn);
    expect(r.options).toBeUndefined();
  });

  it("parses the (fn, options) form (anonymous context)", () => {
    const r = resolveChildArgs(fn, options);
    expect(r.name).toBeUndefined();
    expect(r.fn).toBe(fn);
    expect(r.options).toBe(options);
  });

  it("parses the (fn) form", () => {
    const r = resolveChildArgs(fn);
    expect(r.name).toBeUndefined();
    expect(r.fn).toBe(fn);
    expect(r.options).toBeUndefined();
  });

  it("treats an explicit undefined name as the (name, fn) form", () => {
    const r = resolveChildArgs(undefined, fn, options);
    expect(r.name).toBeUndefined();
    expect(r.fn).toBe(fn);
    expect(r.options).toBe(options);
  });
});
