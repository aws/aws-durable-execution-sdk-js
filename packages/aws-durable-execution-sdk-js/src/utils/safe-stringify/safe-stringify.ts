import { isErrorLike } from "../error-object/is-error-like";
export const safeStringify = (data: unknown): string => {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      data,
      (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);

          // Handle Error objects by extracting their properties
          if (isErrorLike(value)) {
            return {
              ...value,
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
        }
        return value;
      },
      2,
    );
  } catch {
    return "[Unable to stringify]";
  }
};
