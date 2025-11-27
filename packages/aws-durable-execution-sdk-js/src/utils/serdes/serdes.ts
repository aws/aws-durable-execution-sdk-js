/**
 * Context information passed to Serdes for external storage operations
 *
 * @public
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
 *
 * @public
 */
export interface Serdes<T> {
  /**
   * Serializes a value to a string representation
   * @param value - The value to serialize
   * @param context - Context information for external storage (entityId, durableExecutionArn)
   * @returns A Promise that resolves to a string representation of the value or pointer
   */
  serialize: (
    value: T | undefined,
    context: SerdesContext,
  ) => Promise<string | undefined>;

  /**
   * Deserializes a string back to the original value
   * @param data - The string to deserialize (could be actual data or a pointer)
   * @param context - Context information for external storage (entityId, durableExecutionArn)
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
 *
 * Note: Uses 'any' type intentionally as this is a generic serializer that must
 * handle arbitrary JavaScript values. JSON.stringify/parse work with any type,
 * and using more restrictive types would break compatibility with the generic
 * Serdes<T> interface when T can be any type.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const defaultSerdes: Serdes<any> = {
  serialize: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    _context: SerdesContext,
  ): Promise<string | undefined> =>
    value !== undefined ? JSON.stringify(value) : undefined,
  deserialize: async (
    data: string | undefined,
    _context: SerdesContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => (data !== undefined ? JSON.parse(data) : undefined),
};

/**
 * Creates a Serdes for a specific class that preserves the class type. This implementation
 * is a basic class wrapper and does not support any complex class structures. If you need
 * custom serialization, it is recommended to create your own custom serdes.
 *
 * @param cls - The class constructor (must have no required parameters)
 * @returns A Serdes that maintains the class type during serialization/deserialization
 *
 * @example
 * ```typescript
 * class User {
 *   name: string = "";
 *   age: number = 0;
 *
 *   greet() {
 *     return `Hello, ${this.name}`;
 *   }
 * }
 *
 * const userSerdes = createClassSerdes(User);
 *
 * // In a durable function:
 * const user = await context.step("create-user", async () => {
 *   const u = new User();
 *   u.name = "Alice";
 *   u.age = 30;
 *   return u;
 * }, { serdes: userSerdes });
 *
 * console.log(user.greet()); // "Hello, Alice" - methods are preserved
 * ```
 *
 * Limitations:
 * - Class instances becomes plain objects and loses all class information
 * - Constructor must have no parameters
 * - Constructor side-effects will re-run during deserialization
 * - Private fields (#field) cannot be serialized
 * - Getters/setters are not preserved
 * - Nested class instances lose their prototype
 *
 * For classes with Date properties, use createClassSerdesWithDates instead.
 *
 * @beta
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
 * Creates a custom Serdes for a class with special handling for Date properties. This implementation
 * is a basic class wrapper and does not support any complex class structures. If you need
 * custom serialization, it is recommended to create your own custom serdes.
 *
 * @param cls - The class constructor (must have no required parameters)
 * @param dateProps - Array of property paths that should be converted to Date objects (supports nested paths like "metadata.createdAt")
 * @returns A Serdes that maintains the class type and converts specified properties to Date objects
 *
 * @example
 * ```typescript
 * class Article {
 *   title: string = "";
 *   createdAt: Date = new Date();
 *   metadata: {
 *     publishedAt: Date;
 *     updatedAt: Date;
 *   } = {
 *     publishedAt: new Date(),
 *     updatedAt: new Date()
 *   };
 *
 *   getAge() {
 *     return Date.now() - this.createdAt.getTime();
 *   }
 * }
 *
 * const articleSerdes = createClassSerdesWithDates(Article, [
 *   "createdAt",
 *   "metadata.publishedAt",
 *   "metadata.updatedAt"
 * ]);
 *
 * // In a durable function:
 * const article = await context.step("create-article", async () => {
 *   const a = new Article();
 *   a.title = "My Article";
 *   return a;
 * }, { serdes: articleSerdes });
 *
 * console.log(article.getAge()); // Works! Dates are properly restored
 * ```
 *
 * Limitations:
 * - Class instances becomes plain objects and loses all class information
 * - Constructor must have no parameters
 * - Constructor side-effects will re-run during deserialization
 * - Private fields (#field) cannot be serialized
 * - Getters/setters are not preserved
 * - Nested class instances lose their prototype
 *
 * For classes with Date properties, use createClassSerdesWithDates instead.
 *
 * @beta
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

      // Convert date strings back to Date objects (supports nested paths)
      for (const prop of dateProps) {
        const parts = prop.split(".");
        let obj: Record<string, unknown> = instance as Record<string, unknown>;

        // Navigate to parent of target property
        for (let i = 0; i < parts.length - 1; i++) {
          const next = obj[parts[i]];
          if (!next || typeof next !== "object") break;
          obj = next as Record<string, unknown>;
        }

        // Convert to Date if path exists
        const lastKey = parts[parts.length - 1];
        if (obj[lastKey]) {
          obj[lastKey] = new Date(obj[lastKey] as string);
        }
      }

      return instance;
    },
  };
}
