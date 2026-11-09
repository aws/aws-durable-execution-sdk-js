export const safeStringify = (data: unknown): string => {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);

          // Handle Error objects by extracting their properties
          if (value instanceof Error) {
            // A spread copies only enumerable properties, and the native
            // cause is not enumerable. So the cause is copied here.
            return {
              ...value,
              name: value.name,
              message: value.message,
              stack: value.stack,
              ...(value.cause !== undefined && { cause: value.cause }),
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
