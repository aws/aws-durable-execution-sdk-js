import * as vm from "vm";
import { isError } from "./is-error";

describe("isError", () => {
  describe("same-realm errors", () => {
    it("returns true for a standard Error", () => {
      expect(isError(new Error("boom"))).toBe(true);
    });

    it("returns true for built-in Error subclasses", () => {
      expect(isError(new TypeError("t"))).toBe(true);
      expect(isError(new RangeError("r"))).toBe(true);
    });

    it("returns true for a custom Error subclass", () => {
      class CustomError extends Error {}
      expect(isError(new CustomError("c"))).toBe(true);
    });

    it("returns true for an object whose prototype chain includes Error.prototype", () => {
      const fake = Object.create(Error.prototype);
      fake.message = "m";
      fake.name = "n";
      expect(isError(fake)).toBe(true);
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
      expect(isError(crossRealmError)).toBe(true);
      expect((crossRealmError as Error).message).toBe(
        "Error from different Node.js realm",
      );
    });

    it("returns true for cross-realm Error subclasses", () => {
      const context = vm.createContext({});
      const crossRealmTypeError = vm.runInContext(
        'new TypeError("cross-realm type error")',
        context,
      );

      expect(crossRealmTypeError instanceof Error).toBe(false);
      expect(isError(crossRealmTypeError)).toBe(true);
    });
  });

  describe("plain data that merely looks like an error", () => {
    // Regression guard: an earlier implementation duck-typed on the presence of
    // `message` and `name`, which made ordinary logged data look like an error
    // and caused errorType/errorMessage/stackTrace to be injected into
    // unrelated log entries.
    it("returns false for customer data carrying name and message", () => {
      expect(isError({ name: "bob", message: "please gift wrap" })).toBe(false);
    });

    it("returns false even when the object also carries a stack property", () => {
      expect(isError({ name: "n", message: "m", stack: "s" })).toBe(false);
    });

    it("returns false for a null-prototype object with name and message", () => {
      const bare = Object.create(null);
      bare.name = "n";
      bare.message = "m";
      expect(isError(bare)).toBe(false);
    });
  });

  describe("explicit opt-in", () => {
    it("returns true for a value that brands itself as an Error", () => {
      const branded = {
        name: "CustomTransportError",
        message: "m",
        [Symbol.toStringTag]: "Error",
      };
      expect(isError(branded)).toBe(true);
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
      expect(isError(value)).toBe(false);
    });
  });
});
