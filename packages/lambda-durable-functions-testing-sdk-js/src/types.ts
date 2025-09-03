declare const tags: unique symbol;
export type Tagged<BaseType, Tag extends PropertyKey> = BaseType & {
  [tags]: Record<Tag, void>;
};

/**
 * Recursively converts all Date types to number types in a nested object structure.
 */
export type ConvertDatesToNumbers<T> = T extends Date
  ? number
  : T extends (infer U)[]
  ? ConvertDatesToNumbers<U>[]
  : T extends object
  ? { [K in keyof T]: ConvertDatesToNumbers<T[K]> }
  : T;
