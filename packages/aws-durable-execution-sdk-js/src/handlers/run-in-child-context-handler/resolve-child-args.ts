import { ChildConfig, ChildFunc } from "../../types/child-context";
import { DurableLogger } from "../../types/durable-logger";

/**
 * Disambiguates the `runInChildContext` overloads — `(name, fn, options)` vs
 * `(fn, options)` — into a single normalized shape. Shared by the child-context
 * handler and by DurableContext.runInChildContext so the overload logic lives
 * in exactly one place.
 *
 * Kept in its own module (rather than in run-in-child-context-handler.ts) so
 * callers can use it even when that handler module is mocked in tests.
 * @internal
 */
export function resolveChildArgs<T, Logger extends DurableLogger>(
  nameOrFn: string | undefined | ChildFunc<T, Logger>,
  fnOrOptions?: ChildFunc<T, Logger> | ChildConfig<T>,
  maybeOptions?: ChildConfig<T>,
): {
  name: string | undefined;
  fn: ChildFunc<T, Logger>;
  options: ChildConfig<T> | undefined;
} {
  if (typeof nameOrFn === "string" || nameOrFn === undefined) {
    return {
      name: nameOrFn,
      fn: fnOrOptions as ChildFunc<T, Logger>,
      options: maybeOptions,
    };
  }
  return {
    name: undefined,
    fn: nameOrFn,
    options: fnOrOptions as ChildConfig<T>,
  };
}
