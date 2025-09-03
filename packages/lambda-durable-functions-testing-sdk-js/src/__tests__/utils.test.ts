import { ErrorObject } from "@amzn/dex-internal-sdk";
import {
  convertDatesToTimestamps,
  transformErrorObjectToErrorResult,
} from "../utils";

describe("convertDatesToTimestamps", () => {
  it("should return null when input is null", () => {
    expect(convertDatesToTimestamps(null)).toBeNull();
  });

  it("should return undefined when input is undefined", () => {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(convertDatesToTimestamps(undefined)).toBeUndefined();
  });

  it("should convert Date objects to timestamps", () => {
    const date = new Date("2023-01-01T12:00:00Z");
    const input = { date };
    const expected = { date: Math.floor(date.getTime() / 1000) };

    expect(convertDatesToTimestamps(input)).toEqual(expected);
  });

  it("should handle nested objects with dates", () => {
    const date = new Date("2023-01-01T12:00:00Z");
    const nestedDate = new Date("2023-02-01T12:00:00.000Z");
    const timestamp1 = Math.floor(date.getTime() / 1000);
    const timestamp2 = Math.floor(nestedDate.getTime() / 1000);

    const input = {
      outer: {
        date1: date,
        inner: {
          date2: nestedDate,
        },
      },
    };

    const expected = {
      outer: {
        date1: timestamp1,
        inner: {
          date2: timestamp2,
        },
      },
    };

    expect(convertDatesToTimestamps(input)).toEqual(expected);
  });

  it("should handle arrays with dates", () => {
    const date1 = new Date("2023-01-01T12:00:00Z");
    const date2 = new Date("2023-02-01T12:00:00Z");
    const timestamp1 = Math.floor(date1.getTime() / 1000);
    const timestamp2 = Math.floor(date2.getTime() / 1000);

    const input = [{ date: date1 }, { date: date2 }];
    const expected = [{ date: timestamp1 }, { date: timestamp2 }];

    expect(convertDatesToTimestamps(input)).toEqual(expected);
  });
});

describe("transformErrorObjectToErrorResult", () => {
  describe("with valid ErrorObject", () => {
    it("should transform complete ErrorObject to TestResultError", () => {
      const errorObject: ErrorObject = {
        ErrorData: "some error data",
        ErrorMessage: "Test error message",
        ErrorType: "TestError",
        StackTrace: ["at test (test.js:1:1)", "at main (main.js:5:5)"],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "some error data",
        errorMessage: "Test error message",
        errorType: "TestError",
        stackTrace: ["at test (test.js:1:1)", "at main (main.js:5:5)"],
      });
    });

    it("should handle ErrorObject with undefined ErrorData", () => {
      const errorObject: ErrorObject = {
        ErrorData: undefined,
        ErrorMessage: "Error without data",
        ErrorType: "NoDataError",
        StackTrace: ["at test (test.js:1:1)"],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: undefined,
        errorMessage: "Error without data",
        errorType: "NoDataError",
        stackTrace: ["at test (test.js:1:1)"],
      });
    });

    it("should handle ErrorObject with undefined ErrorMessage", () => {
      const errorObject: ErrorObject = {
        ErrorData: "error data",
        ErrorMessage: undefined,
        ErrorType: "NoMessageError",
        StackTrace: ["at test (test.js:1:1)"],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "error data",
        errorMessage: undefined,
        errorType: "NoMessageError",
        stackTrace: ["at test (test.js:1:1)"],
      });
    });

    it("should handle ErrorObject with undefined ErrorType", () => {
      const errorObject: ErrorObject = {
        ErrorData: "error data",
        ErrorMessage: "Error message",
        ErrorType: undefined,
        StackTrace: ["at test (test.js:1:1)"],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "error data",
        errorMessage: "Error message",
        errorType: undefined,
        stackTrace: ["at test (test.js:1:1)"],
      });
    });

    it("should handle ErrorObject with undefined StackTrace", () => {
      const errorObject: ErrorObject = {
        ErrorData: "error data",
        ErrorMessage: "Error message",
        ErrorType: "NoStackError",
        StackTrace: undefined,
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "error data",
        errorMessage: "Error message",
        errorType: "NoStackError",
        stackTrace: undefined,
      });
    });

    it("should handle ErrorObject with empty StackTrace array", () => {
      const errorObject: ErrorObject = {
        ErrorData: "error data",
        ErrorMessage: "Error message",
        ErrorType: "EmptyStackError",
        StackTrace: [],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "error data",
        errorMessage: "Error message",
        errorType: "EmptyStackError",
        stackTrace: [],
      });
    });

    it("should handle ErrorObject with single stack trace entry", () => {
      const errorObject: ErrorObject = {
        ErrorData: "error data",
        ErrorMessage: "Error message",
        ErrorType: "SingleStackError",
        StackTrace: ["Error: SingleStackError"],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "error data",
        errorMessage: "Error message",
        errorType: "SingleStackError",
        stackTrace: ["Error: SingleStackError"],
      });
    });

    it("should handle ErrorObject with all properties undefined", () => {
      const errorObject: ErrorObject = {
        ErrorData: undefined,
        ErrorMessage: undefined,
        ErrorType: undefined,
        StackTrace: undefined,
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: undefined,
        errorMessage: undefined,
        errorType: undefined,
        stackTrace: undefined,
      });
    });

    it("should handle ErrorObject with empty strings", () => {
      const errorObject: ErrorObject = {
        ErrorData: "",
        ErrorMessage: "",
        ErrorType: "",
        StackTrace: [""],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: "",
        errorMessage: "",
        errorType: "",
        stackTrace: [""],
      });
    });

    it("should handle ErrorObject with complex stack trace", () => {
      const errorObject: ErrorObject = {
        ErrorData: '{"context": "test", "timestamp": 1234567890}',
        ErrorMessage: "Complex error occurred",
        ErrorType: "ComplexError",
        StackTrace: [
          "ComplexError: Complex error occurred",
          "    at ComplexClass.method (complex.js:10:5)",
          "    at async AsyncFunction (async.js:25:12)",
          "    at Object.<anonymous> (index.js:1:1)",
          "    at Module._compile (internal/modules/cjs/loader.js:999:30)",
        ],
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result).toEqual({
        errorData: '{"context": "test", "timestamp": 1234567890}',
        errorMessage: "Complex error occurred",
        errorType: "ComplexError",
        stackTrace: [
          "ComplexError: Complex error occurred",
          "    at ComplexClass.method (complex.js:10:5)",
          "    at async AsyncFunction (async.js:25:12)",
          "    at Object.<anonymous> (index.js:1:1)",
          "    at Module._compile (internal/modules/cjs/loader.js:999:30)",
        ],
      });
    });

    it("should not preserve reference equality for arrays", () => {
      const stackTrace = ["Error: test", "at test (test.js:1:1)"];
      const errorObject: ErrorObject = {
        ErrorData: "test",
        ErrorMessage: "test",
        ErrorType: "test",
        StackTrace: stackTrace,
      };

      const result = transformErrorObjectToErrorResult(errorObject);

      expect(result?.stackTrace).not.toBe(stackTrace);
      expect(result?.stackTrace).toEqual(stackTrace);
    });
  });

  it("should return undefined when error parameter is undefined", () => {
    const result = transformErrorObjectToErrorResult(undefined);

    expect(result).toBeUndefined();
  });
});
