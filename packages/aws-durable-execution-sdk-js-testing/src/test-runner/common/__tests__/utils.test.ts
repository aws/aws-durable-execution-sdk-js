import { tryJsonParse } from "../utils";

describe("tryJsonParse", () => {
  describe("valid JSON parsing", () => {
    it("should parse valid JSON objects", () => {
      const jsonString = '{"name": "test", "count": 42}';
      const result = tryJsonParse<{ name: string; count: number }>(jsonString);

      expect(result).toEqual({ name: "test", count: 42 });
    });

    it("should parse valid JSON arrays", () => {
      const jsonString = '[1, 2, 3, "test"]';
      const result = tryJsonParse<(number | string)[]>(jsonString);

      expect(result).toEqual([1, 2, 3, "test"]);
    });

    it("should parse JSON strings", () => {
      const jsonString = '"hello world"';
      const result = tryJsonParse<string>(jsonString);

      expect(result).toBe("hello world");
    });

    it("should parse JSON numbers", () => {
      const jsonString = "42";
      const result = tryJsonParse<number>(jsonString);

      expect(result).toBe(42);
    });

    it("should parse JSON booleans", () => {
      const jsonStringTrue = "true";
      const jsonStringFalse = "false";

      expect(tryJsonParse<boolean>(jsonStringTrue)).toBe(true);
      expect(tryJsonParse<boolean>(jsonStringFalse)).toBe(false);
    });

    it("should parse JSON null", () => {
      const jsonString = "null";
      const result = tryJsonParse<null>(jsonString);

      expect(result).toBeNull();
    });

    it("should parse nested JSON objects", () => {
      const jsonString =
        '{"user": {"name": "John", "details": {"age": 30, "active": true}}}';
      const result = tryJsonParse<{
        user: { name: string; details: { age: number; active: boolean } };
      }>(jsonString);

      expect(result).toEqual({
        user: {
          name: "John",
          details: {
            age: 30,
            active: true,
          },
        },
      });
    });
  });

  describe("malformed JSON handling", () => {
    it("should return original string for malformed JSON", () => {
      const malformedJson = '{"name": test}'; // missing quotes around test
      const result = tryJsonParse<string>(malformedJson);

      expect(result).toBe(malformedJson);
    });

    it("should return original string for incomplete JSON", () => {
      const incompleteJson = '{"name": "test"';
      const result = tryJsonParse<string>(incompleteJson);

      expect(result).toBe(incompleteJson);
    });

    it("should return original string for invalid JSON syntax", () => {
      const invalidJson = "{ invalid json syntax }";
      const result = tryJsonParse<string>(invalidJson);

      expect(result).toBe(invalidJson);
    });

    it("should return original string for empty braces with invalid content", () => {
      const invalidJson = "{not valid}";
      const result = tryJsonParse<string>(invalidJson);

      expect(result).toBe(invalidJson);
    });
  });

  describe("edge cases", () => {
    it("should return undefined for undefined input", () => {
      const result = tryJsonParse<unknown>(undefined);

      expect(result).toBeUndefined();
    });

    it("should handle empty string", () => {
      const result = tryJsonParse<string>("");

      expect(result).toBe("");
    });

    it("should handle whitespace-only string", () => {
      const whitespaceString = "   \n\t  ";
      const result = tryJsonParse<string>(whitespaceString);

      expect(result).toBe(whitespaceString);
    });

    it("should handle plain text strings", () => {
      const plainText = "hello world";
      const result = tryJsonParse<string>(plainText);

      expect(result).toBe(plainText);
    });

    it("should handle numeric strings that are not JSON", () => {
      const numericString = "123abc";
      const result = tryJsonParse<string>(numericString);

      expect(result).toBe(numericString);
    });

    it("should handle strings that look like JSON but aren't", () => {
      const fakeJson = "{'key': value}"; // single quotes instead of double
      const result = tryJsonParse<string>(fakeJson);

      expect(result).toBe(fakeJson);
    });
  });

  describe("type parameter behavior", () => {
    it("should work with generic type parameters", () => {
      interface TestInterface {
        id: number;
        name: string;
        active: boolean;
      }

      const jsonString = '{"id": 1, "name": "test", "active": true}';
      const result = tryJsonParse<TestInterface>(jsonString);

      expect(result).toEqual({
        id: 1,
        name: "test",
        active: true,
      });
    });

    it("should work with union types", () => {
      const stringJson = '"test string"';
      const numberJson = "42";
      const objectJson = '{"key": "value"}';

      const stringResult = tryJsonParse<string | number | object>(stringJson);
      const numberResult = tryJsonParse<string | number | object>(numberJson);
      const objectResult = tryJsonParse<string | number | object>(objectJson);

      expect(stringResult).toBe("test string");
      expect(numberResult).toBe(42);
      expect(objectResult).toEqual({ key: "value" });
    });

    it("should work with array types", () => {
      const arrayJson = '["item1", "item2", "item3"]';
      const result = tryJsonParse<string[]>(arrayJson);

      expect(result).toEqual(["item1", "item2", "item3"]);
    });

    it("should maintain type safety even with type assertion", () => {
      // This tests that the function behaves correctly even though it uses type assertion internally
      const jsonString = '{"count": 42}';
      const result = tryJsonParse<{ count: number }>(jsonString);

      expect(result).toEqual({ count: 42 });
      expect(typeof result?.count).toBe("number");
    });
  });

  describe("complex JSON scenarios", () => {
    it("should handle JSON with special characters", () => {
      const jsonString =
        '{"message": "Hello\\nWorld\\t!", "emoji": "🚀", "special": "quote: \\"test\\""}';
      const result = tryJsonParse<{
        message: string;
        emoji: string;
        special: string;
      }>(jsonString);

      expect(result).toEqual({
        message: "Hello\nWorld\t!",
        emoji: "🚀",
        special: 'quote: "test"',
      });
    });

    it("should handle JSON with various data types mixed", () => {
      const jsonString =
        '{"string": "test", "number": 42, "boolean": true, "null_value": null, "array": [1, 2, 3], "nested": {"key": "value"}}';
      const result = tryJsonParse<{
        string: string;
        number: number;
        boolean: boolean;
        null_value: null;
        array: number[];
        nested: { key: string };
      }>(jsonString);

      expect(result).toEqual({
        string: "test",
        number: 42,
        boolean: true,
        null_value: null,
        array: [1, 2, 3],
        nested: { key: "value" },
      });
    });

    it("should handle large JSON objects", () => {
      const largeObject = {
        data: new Array(100).fill(0).map((_, i) => ({
          id: i,
          name: `item-${i}`,
          active: i % 2 === 0,
        })),
      };
      const jsonString = JSON.stringify(largeObject);
      const result = tryJsonParse<typeof largeObject>(jsonString);

      expect(result).toEqual(largeObject);
      expect(result?.data).toHaveLength(100);
    });
  });

  describe("fallback behavior consistency", () => {
    it("should consistently return the original string for any parsing failure", () => {
      const testCases = [
        "{ malformed",
        '{"key": }',
        "undefined",
        "function() {}",
        "[1, 2, 3,]", // trailing comma
        '{"key": "value",}', // trailing comma in object
      ];

      testCases.forEach((testCase) => {
        const result = tryJsonParse<string>(testCase);
        expect(result).toBe(testCase);
      });
    });

    it("should handle various invalid JSON patterns consistently", () => {
      const invalidJsonPatterns = [
        "{'single': 'quotes'}",
        '{key: "no quotes on key"}',
        '{"trailing comma": true,}',
        "NaN",
        "Infinity",
        "-Infinity",
        "new Date()",
        "/regex/",
      ];

      invalidJsonPatterns.forEach((pattern) => {
        const result = tryJsonParse<string>(pattern);
        expect(result).toBe(pattern);
      });
    });
  });
});
