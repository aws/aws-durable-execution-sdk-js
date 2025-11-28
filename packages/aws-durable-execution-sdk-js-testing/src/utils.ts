import { ErrorObject } from "@aws-sdk/client-lambda";
import type { ConvertDatesToNumbers } from "./types";
import { TestResultError } from "./test-runner";

/**
 * Type-safe map values function that traverses objects and arrays
 *
 * @param obj The object or array to traverse
 * @param fn Function to apply to each value
 * @returns The transformed object with the same structure
 */
function mapValuesDeep(
  obj: unknown,
  fn: (val: unknown, key?: string | number) => unknown,
): unknown {
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item, idx) => mapValuesDeep(item, (val) => fn(val, idx)));
  }

  // Handle plain objects (but not class instances like Date)
  if (
    obj !== null &&
    typeof obj === "object" &&
    // Handle cross-realm objects
    Object.prototype.toString.call(obj) === "[object Object]"
  ) {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      result[key] = mapValuesDeep(value, fn);
    }

    return result;
  }

  // Apply the transform function to primitive values or class instances
  return fn(obj);
}

/**
 * Converts Date objects or ISO date strings in an object to Unix timestamps (seconds)
 *
 * This function maintains the structure of the input object/array while
 * converting Date objects and ISO date strings to numeric timestamps
 *
 * @param obj The object to process
 * @returns The same object structure with dates converted to timestamps
 */
export function convertDatesToTimestamps<T>(obj: T): ConvertDatesToNumbers<T> {
  if (obj === null || obj === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return obj as ConvertDatesToNumbers<T>;
  }

  const result = mapValuesDeep(obj, (value) => {
    // Handle Date objects and convert them to numbers
    if (value instanceof Date) {
      return value.getTime() / 1000;
    }

    // Return unchanged for other types
    return value;
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as ConvertDatesToNumbers<T>;
}

export function reparseDates<T>(obj: T, dateConstructor: DateConstructor): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  const result = mapValuesDeep(obj, (value) => {
    if (Object.prototype.toString.call(value) === "[object Date]") {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return new dateConstructor((value as Date).getTime());
    }
    return value;
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as T;
}

export function transformErrorObjectToErrorResult(
  error: ErrorObject | undefined,
): TestResultError | undefined {
  if (!error) {
    return undefined;
  }

  return {
    errorData: error.ErrorData,
    errorMessage: error.ErrorMessage,
    errorType: error.ErrorType,
    stackTrace: error.StackTrace ? Array.from(error.StackTrace) : undefined,
  };
}
