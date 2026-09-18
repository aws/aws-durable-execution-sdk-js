import * as vm from "vm";
import { isErrorLike } from "./is-error-like";

describe("isErrorLike", () => {
  describe("same-realm errors", () => {
    it("returns true for a standard Error", () => {
      expect(isErrorLike(new Error("boom"))).toBe(true);
    });

    it("returns true for built-in Error subclasses", () => {
      expect(isErrorLike(new TypeError("t"))).toBe(true);
      expect(isErrorLike(new RangeError("r"))).toBe(true);
    });

    it("returns true for a custom Error subclass", () => {
      class CustomError extends Error {}
      expect(isErrorLike(new CustomError("c"))).toBe(true);
    });
  });

  describe("cross-realm errors", () => {
    it("returns true for an Error thrown from a different Node.js realm", () => {
      // Errors thrown from a `vm` context are instances of that context's Error
      // constructor, not the host realm's, so `instanceof Error` is false here.
      const context = vm.createContext({});
      let crossRealmError: unknown;
      try {
        vm.runInContext(
          'throw new Error("Error from different Node.js realm")',
          context,
        );
      } catch (error) {
        crossRealmError = error;
      }

      // Sanity check: this is exactly the case a bare instanceof misses.
      expect(crossRealmError instanceof Error).toBe(false);
      expect(isErrorLike(crossRealmError)).toBe(true);
      expect((crossRealmError as Error).message).toBe(
        "Error from different Node.js realm",
      );
    });
  });

  describe("error-like objects", () => {
    it("returns true for an object with message and name", () => {
      expect(isErrorLike({ message: "m", name: "n" })).toBe(true);
    });

    it("returns true for an object created from Error.prototype", () => {
      const fake = Object.create(Error.prototype);
      fake.message = "m";
      fake.name = "n";
      expect(isErrorLike(fake)).toBe(true);
    });
  });

  describe("non error-like values", () => {
    it.each([
      ["a string", "boom"],
      ["a number", 42],
      ["a boolean", true],
      ["null", null],
      ["undefined", undefined],
      ["an empty object", {}],
      ["an array", ["boom"]],
      ["an object with only message", { message: "m" }],
      ["an object with only name", { name: "n" }],
    ])("returns false for %s", (_label, value) => {
      expect(isErrorLike(value)).toBe(false);
    });
  });
});
