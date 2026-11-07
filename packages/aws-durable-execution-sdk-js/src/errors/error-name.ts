/**
 * Returns the `name` for an SDK error.
 *
 * A minifying bundler can rename a class, so an SDK error class passes its
 * fixed name. A subclass outside the SDK keeps its own class name.
 *
 * @param error - The error being constructed
 * @param sdkClass - The SDK error class that sets the fixed name
 * @param fixedName - The fixed name of that class
 */
export function sdkErrorName(
  error: Error,
  sdkClass: abstract new (...args: never[]) => Error,
  fixedName: string,
): string {
  return error.constructor === sdkClass ? fixedName : error.constructor.name;
}
