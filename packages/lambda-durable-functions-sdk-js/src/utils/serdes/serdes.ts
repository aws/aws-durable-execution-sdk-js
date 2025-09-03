/**
 * Context information passed to Serdes for external storage operations
 */
export interface SerdesContext {
  /** Unique identifier for the step/entity being serialized */
  entityId: string;
  /** ARN of the durable execution to avoid collisions between executions */
  durableExecutionArn: string;
}

/**
 * Serdes (Serialization/Deserialization) interface for durable functions.
 * This interface allows customizing how data is serialized and deserialized
 * when persisting state in durable functions.
 *
 * Both methods are async to support custom implementations that need to
 * interact with external services (e.g., AWS S3, DynamoDB, etc.)
 */
export interface Serdes<T> {
  /**
   * Serializes a value to a string representation
   * @param value The value to serialize
   * @param context Context information for external storage (entityId, durableExecutionArn)
   * @returns A Promise that resolves to a string representation of the value or pointer
   */
  serialize: (
    value: T | undefined,
    context: SerdesContext,
  ) => Promise<string | undefined>;

  /**
   * Deserializes a string back to the original value
   * @param data The string to deserialize (could be actual data or a pointer)
   * @param context Context information for external storage (entityId, durableExecutionArn)
   * @returns A Promise that resolves to the deserialized value
   */
  deserialize: (
    data: string | undefined,
    context: SerdesContext,
  ) => Promise<T | undefined>;
}

/**
 * Default Serdes implementation using JSON.stringify and JSON.parse
 * Wrapped in Promise.resolve() to maintain async interface compatibility
 * Ignores context parameter since it uses inline JSON serialization
 */
export const defaultSerdes: Serdes<any> = {
  serialize: async (
    value: any,
    _context: SerdesContext,
  ): Promise<string | undefined> =>
    value !== undefined ? JSON.stringify(value) : undefined,
  deserialize: async (
    data: string | undefined,
    _context: SerdesContext,
  ): Promise<any> => (data !== undefined ? JSON.parse(data) : undefined),
};

/**
 * Creates a Serdes for a specific class that preserves the class type
 * @param cls The class constructor
 * @returns A Serdes that maintains the class type during serialization/deserialization
 *
 * Note: This basic implementation doesn't handle special types like Date objects.
 * For classes with Date properties or other complex types, you'll need to create
 * a custom Serdes implementation.
 */
export function createClassSerdes<T extends object>(
  cls: new () => T,
): Serdes<T> {
  return {
    serialize: async (
      value: T | undefined,
      _context: SerdesContext,
    ): Promise<string | undefined> =>
      value !== undefined ? JSON.stringify(value) : undefined,
    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
    ): Promise<T | undefined> =>
      data !== undefined
        ? Object.assign(new cls(), JSON.parse(data))
        : undefined,
  };
}

/**
 * Creates a custom Serdes for a class with special handling for Date properties
 * @param cls The class constructor
 * @param dateProps Array of property names that should be converted to Date objects
 * @returns A Serdes that maintains the class type and converts specified properties to Date objects
 */
export function createClassSerdesWithDates<T extends object>(
  cls: new () => T,
  dateProps: string[],
): Serdes<T> {
  return {
    serialize: async (
      value: T | undefined,
      _context: SerdesContext,
    ): Promise<string | undefined> =>
      value !== undefined ? JSON.stringify(value) : undefined,
    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
    ): Promise<T | undefined> => {
      if (data === undefined) {
        return undefined;
      }

      const parsed = JSON.parse(data);
      const instance = new cls();

      // Copy all properties from parsed object to the new instance
      Object.assign(instance, parsed);

      // Convert date strings back to Date objects
      for (const prop of dateProps) {
        if (parsed[prop]) {
          (instance as Record<string, unknown>)[prop] = new Date(parsed[prop]);
        }
      }

      return instance;
    },
  };
}
