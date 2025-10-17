import { safeStringify } from "./safe-stringify";

describe("safeStringify", () => {
  it("should stringify simple objects", () => {
    const obj = { name: "test", value: 42 };
    const result = safeStringify(obj);
    expect(result).toBe(JSON.stringify(obj, null, 2));
  });

  it("should handle circular references", () => {
    const obj: any = { name: "test" };
    obj.self = obj;
    const result = safeStringify(obj);
    expect(result).toContain('"name": "test"');
    expect(result).toContain('"self": "[Circular]"');
  });

  it("should handle nested circular references", () => {
    const obj: any = { a: { b: {} } };
    obj.a.b.c = obj;
    const result = safeStringify(obj);
    expect(result).toContain('"c": "[Circular]"');
  });

  it("should handle arrays with circular references", () => {
    const arr: any[] = [1, 2];
    arr.push(arr);
    const result = safeStringify(arr);
    expect(result).toContain("[Circular]");
  });

  it("should handle null and undefined", () => {
    expect(safeStringify(null)).toBe("null");
    expect(safeStringify(undefined)).toBe(undefined);
  });

  it("should handle primitives", () => {
    expect(safeStringify("string")).toBe('"string"');
    expect(safeStringify(42)).toBe("42");
    expect(safeStringify(true)).toBe("true");
  });

  it("should return fallback for non-serializable values", () => {
    const obj = { fn: (): void => {} };
    const result = safeStringify(obj);
    expect(result).toContain("{}");
  });

  it("should handle BigInt values that cannot be serialized", () => {
    const obj = { value: BigInt(9007199254740991) };
    const result = safeStringify(obj);
    expect(result).toBe("[Unable to stringify]");
  });

  it("should handle Error objects", () => {
    const error = new Error("hello world");
    const result = safeStringify(error);
    expect(result).toContain('"message": "hello world"');
    expect(result).toContain('"name": "Error"');
    expect(result).toContain('"stack"');
  });

  it("should handle nested Error objects", () => {
    const obj = { error: new Error("nested error"), data: "test" };
    const result = safeStringify(obj);
    expect(result).toContain('"message": "nested error"');
    expect(result).toContain('"data": "test"');
  });
});
